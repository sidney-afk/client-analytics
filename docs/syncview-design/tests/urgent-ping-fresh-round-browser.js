'use strict';
/* urgent-ping-fresh-round-browser.js -- the URGENT ping uses the round stamp the
 * database holds, and a refused ping is logged and recoverable.
 *
 * Fully offline. Every backend answer is local (urgent-ping-mock-lib.js), and
 * only the test client appears. Nothing here reaches a live backend, sends a
 * Slack message or writes to a real table.
 *
 * The mock follows the real rules that matter: calendar-upsert echoes the patch
 * and never carries *_status_at; a trigger stamps video_status_at when the
 * status really changes; the ping gateway compares the page's stamp with the
 * row's and the row's status (urgentSnapshot in production-write).
 *
 *   (a) set Tweaks Needed, click URGENT after 0.8 s, 3 s and 11 s: the request
 *       carries the stamp the database holds and is accepted (202);
 *   (a2) right after the status save the page adopts ONLY the stamp columns;
 *   (b) the card was changed by someone else after the save: nothing is sent and
 *       the message says what the card says now (status, then work item link);
 *   (c) a refused ping (409 urgent_target_changed) is logged with its real code
 *       and status, the notice offers "Refresh this card", and the button reads
 *       the card, keeps typed text, re-arms URGENT and the next ping goes;
 *   (d) the stamp read failing never blocks a ping (permissive);
 *   (e) the same on the Samples tab.
 */
const { createEnv, see, sleep } = require('./urgent-ping-mock-lib');

const failures = [];
const check = (cond, message) => { if (!cond) { failures.push(message); console.log('  FAIL  ' + message); } else console.log('  ok    ' + message); };

const CARD = '.cal-card[data-pid="p_t1"]';
async function setTweaks(page) {
  await page.click(CARD + ' .cal-fld-substatus-trigger >> nth=0');
  await page.click('.cal-fld-status-item.cal-fld-status-tweaks-needed');
}
const urgentRequests = S => S.log.filter(l => l.key === 'gw:urgent');
const lastUrgent = S => urgentRequests(S).slice(-1)[0];
const sentStamp = entry => { try { return JSON.parse(entry.summary).video_status_at; } catch (e) { return null; } };
async function waitFor(fn, ms) {
  const end = Date.now() + (ms || 6000);
  while (Date.now() < end) { if (await fn()) return true; await sleep(100); }
  return false;
}
async function clickUrgentAndConfirm(page) {
  await page.click(CARD + ' .cal-urgent-btn');
  await waitFor(() => page.evaluate(() => document.getElementById('confirmOverlay').classList.contains('active')), 4000);
  await page.click('#confirmYes');
}
const modalText = async page => (await see(page)).modal;

async function scenario(name, fn) {
  console.log('\n# ' + name);
  const S = await createEnv();
  try {
    const page = await S.newPage();
    await S.openCalendar(page);
    await fn(S, page);
  } catch (error) {
    failures.push(name + ': threw ' + String(error && error.stack || error).split('\n').slice(0, 3).join(' | '));
    console.log('  FAIL  threw ' + String(error && error.message || error));
  } finally { await S.close(); }
}

(async () => {
  for (const delay of [800, 3000, 11000]) {
    await scenario('(a) URGENT ' + delay + ' ms after setting Tweaks Needed', async (S, page) => {
      await setTweaks(page);
      await sleep(delay);
      await clickUrgentAndConfirm(page);
      check(await waitFor(() => urgentRequests(S).length === 1), 'one ping request reached the gateway');
      const entry = lastUrgent(S);
      const dbStamp = S.card('p_t1').video_status_at;
      check(entry && Date.parse(sentStamp(entry)) === Date.parse(dbStamp), 'the request carries the stamp the database holds (' + (entry && sentStamp(entry)) + ' vs ' + dbStamp + ')');
      check(entry && /http 202/.test(entry.outcome), 'the gateway accepted it: ' + (entry && entry.outcome));
      const shown = await see(page, { btn: CARD + ' .cal-urgent-btn' });
      check(shown.modal && /queued/i.test(shown.modal.title || ''), 'the person is told the ping is queued: ' + JSON.stringify(shown.modal));
    });
  }

  await scenario('(a2) a status save adopts only the stamp columns', async (S, page) => {
    // A typed, unsaved edit must survive; the stamp must arrive without a reload.
    await page.evaluate(() => { const p = calState.posts.find(x => x.id === 'p_t1'); p.cta = 'typed locally, not saved'; });
    const before = await page.evaluate(() => calState.posts.find(x => x.id === 'p_t1').video_status_at);
    await setTweaks(page);
    await waitFor(() => page.evaluate(b => calState.posts.find(x => x.id === 'p_t1').video_status_at !== b, before), 6000);
    const mem = await page.evaluate(() => { const p = calState.posts.find(x => x.id === 'p_t1'); return { at: p.video_status_at, cta: p.cta, name: p.name }; });
    check(Date.parse(mem.at) === Date.parse(S.card('p_t1').video_status_at), 'the page holds the database stamp without a reload (' + mem.at + ')');
    check(mem.cta === 'typed locally, not saved', 'other fields are untouched by the stamp read');
    const reads = S.log.filter(l => l.key === 'READ card p_t1');
    check(reads.length === 1, 'exactly one single-card read after the save (got ' + reads.length + ')');
  });

  await scenario('(a3) a failed save does not read or adopt anything', async (S, page) => {
    S.behave['cal-upsert'] = { mode: 'http', status: 500, body: { ok: false, error: 'boom' }, commit: false, times: 4 };
    S.behave['gw:status'] = { mode: 'http', status: 500, body: { ok: false, error: 'write_failed' }, commit: false, times: 4 };
    await setTweaks(page);
    await sleep(2500);
    check(S.log.filter(l => l.key === 'READ card p_t1').length === 0, 'no single-card read when the save failed');
  });

  await scenario('(b) the card changed under the person before the click', async (S, page) => {
    await setTweaks(page);
    await sleep(2500);
    S.setCardField('p_t1', { video_status: 'For SMM Approval' }, 'teammate');
    await clickUrgentAndConfirm(page);
    await sleep(900);
    check(urgentRequests(S).length === 0, 'no ping request was sent');
    const shown = await modalText(page);
    check(shown && /For SMM Approval/.test(shown.text) && /Nothing was sent/.test(shown.text), 'the message says what the card says now: ' + JSON.stringify(shown));
    check(!/—/.test((shown && shown.text) || ''), 'no em dash in the message');
    const btn = await page.evaluate(sel => { const b = document.querySelector(sel); return b ? { disabled: b.disabled, text: b.textContent } : null; }, CARD + ' .cal-urgent-btn');
    check(!btn || (btn.disabled === false), 'the button is not left stuck on Sending');
    check((await page.evaluate(() => Object.keys(localStorage).filter(k => /native-urgent/.test(k)).length)) === 0, 'no delivery hold was written');
  });

  await scenario('(b2) the work item link changed before the click', async (S, page) => {
    await setTweaks(page);
    await sleep(2500);
    S.setCardField('p_t1', { video_deliverable_id: 'del_other' }, 'teammate');
    await clickUrgentAndConfirm(page);
    await sleep(900);
    check(urgentRequests(S).length === 0, 'no ping request was sent');
    const shown = await modalText(page);
    check(shown && /work item/i.test(shown.text) && /Nothing was sent/.test(shown.text), 'the message names the changed link: ' + JSON.stringify(shown));
  });

  await scenario('(b3) the card is saved while the person confirms: the ping waits for it', async (S, page) => {
    await setTweaks(page);
    await sleep(2500);
    S.behave['cal-upsert'] = { delay: 1500, times: 1 };
    // a field edit starts a save that is still in flight when the ping is confirmed
    await page.fill(CARD + ' [data-fld="name"]', 'Renamed while pinging');
    await page.evaluate(sel => document.querySelector(sel).blur(), CARD + ' [data-fld="name"]');
    await clickUrgentAndConfirm(page);
    check(await waitFor(() => urgentRequests(S).length === 1, 9000), 'the ping went out after the save finished');
    const upsertDone = S.log.filter(l => l.key === 'cal-upsert').slice(-1)[0];
    const ping = lastUrgent(S);
    check(upsertDone && ping && ping.t >= upsertDone.t, 'the ping request came after the save request');
    check(ping && /http 202/.test(ping.outcome), 'accepted: ' + (ping && ping.outcome));
  });

  await scenario('(c) a refused ping is logged with its real code and offers a refresh', async (S, page) => {
    await setTweaks(page);
    await sleep(2500);
    const typed = 'typed while the notice is open';
    // A teammate starts a new round; the pre-ping read fails, so the page sends what it holds.
    S.setCardField('p_t1', { video_status: 'In Progress' }, 'teammate');
    S.setCardField('p_t1', { video_status: 'Tweaks Needed' }, 'teammate');
    S.behave['read:card'] = { mode: 'reject', times: 1 };
    await clickUrgentAndConfirm(page);
    check(await waitFor(() => urgentRequests(S).length === 1), 'the stale ping reached the gateway');
    check(/http 409 urgent_target_changed/.test((lastUrgent(S) || {}).outcome || ''), 'and was refused: ' + (lastUrgent(S) || {}).outcome);
    await waitFor(() => S.diag.some(d => d.operation === 'urgent_ping'), 5000);
    const claim = S.diag.filter(d => d.operation === 'urgent_ping').slice(-1)[0] || {};
    check(claim.code === 'urgent_target_changed', 'the log claim carries the real code: ' + JSON.stringify(claim.code));
    check(claim.status === 409, 'the log claim carries the real status: ' + JSON.stringify(claim.status));
    check(claim.action === 'browser_claim' && claim.surface === 'calendar', 'it is a browser claim from the calendar surface');
    const shown = await modalText(page);
    check(shown && /urgent_target_changed/.test(shown.text), 'the notice quotes the code: ' + JSON.stringify(shown));
    const action = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#confirmOverlay .brief-action-btn')].find(x => /Refresh this card/.test(x.textContent) && x.offsetParent !== null);
      return b ? b.textContent : null;
    });
    check(action === 'Refresh this card', 'the notice offers "Refresh this card"');
    check(!/—/.test((shown && shown.text) || '') && !/—/.test(action || ''), 'no em dash in the notice or the button');
    // The person types after the refusal and has not saved yet: a refresh must not eat it.
    await page.evaluate(t => { const p = calState.posts.find(x => x.id === 'p_t1'); p.cta = t; _calPendingEdits['p_t1'] = Object.assign(_calPendingEdits['p_t1'] || {}, { cta: t }); }, typed);
    // one click
    const readsBefore = S.log.filter(l => l.key === 'READ card p_t1').length;
    await page.evaluate(() => [...document.querySelectorAll('#confirmOverlay .brief-action-btn')].find(x => /Refresh this card/.test(x.textContent)).click());
    await waitFor(() => page.evaluate(() => !document.getElementById('confirmOverlay').classList.contains('active')), 3000);
    await waitFor(() => S.log.filter(l => l.key === 'READ card p_t1').length >= readsBefore + 1, 3000);
    await sleep(400);
    check(S.log.filter(l => l.key === 'READ card p_t1').length === readsBefore + 1, 'one click read the card once');
    check((await page.evaluate(() => document.getElementById('confirmOverlay').classList.contains('active'))) === false, 'the notice closed');
    await waitFor(() => page.evaluate(at => { const p = calState.posts.find(x => x.id === 'p_t1'); return !!p && Date.parse(p.video_status_at) === Date.parse(at); }, S.card('p_t1').video_status_at), 3000);
    const mem = await page.evaluate(() => { const p = calState.posts.find(x => x.id === 'p_t1'); return { at: p.video_status_at, cta: p.cta }; });
    check(Date.parse(mem.at) === Date.parse(S.card('p_t1').video_status_at), 'the card now holds the database stamp');
    check(mem.cta === typed, 'unsaved typed text was kept');
    check(await page.evaluate(() => !!(_calPendingEdits['p_t1'] && _calPendingEdits['p_t1'].cta)), 'and it is still queued as an unsaved edit');
    check(S.card('p_t1').cta !== typed, 'the refresh did not save it behind the person');
    const btn = await page.evaluate(sel => { const b = document.querySelector(sel); return b ? { disabled: b.disabled, text: b.textContent } : null; }, CARD + ' .cal-urgent-btn');
    check(btn && btn.disabled === false && btn.text === 'URGENT', 'URGENT is armed again: ' + JSON.stringify(btn));
    await clickUrgentAndConfirm(page);
    check(await waitFor(() => urgentRequests(S).length === 2), 'the next ping went out');
    check(/http 202/.test((lastUrgent(S) || {}).outcome || ''), 'and was accepted: ' + (lastUrgent(S) || {}).outcome);
  });

  await scenario('(c2) every card-changed code gets the refresh button', async (S, page) => {
    await setTweaks(page);
    await sleep(2500);
    for (const code of ['urgent_round_unavailable', 'urgent_context_unavailable', 'urgent_assignment_unavailable', 'notification_urgent_target_changed']) {
      S.behave['gw:urgent'] = { mode: 'http', status: 409, body: { ok: false, error: code, delivery: 'not_sent', retry_safe: true }, times: 1 };
      await clickUrgentAndConfirm(page);
      await waitFor(() => page.evaluate(() => document.getElementById('confirmOverlay').classList.contains('active') && /code:/.test(document.getElementById('confirmMsg').textContent)), 4000);
      const has = await page.evaluate(() => !![...document.querySelectorAll('#confirmOverlay .brief-action-btn')].find(x => /Refresh this card/.test(x.textContent) && x.offsetParent !== null));
      const claim = S.diag.slice(-1)[0] || {};
      check(has, code + ': offers "Refresh this card"');
      check(claim.status === 409, code + ': logged with status 409 (' + claim.status + ' / ' + claim.code + ')');
      await page.evaluate(() => document.getElementById('confirmYes').click());
      await sleep(200);
    }
    // a code that is not a card-changed class has no refresh button
    S.behave['gw:urgent'] = { mode: 'http', status: 503, body: { ok: false, error: 'urgent_lookup_unavailable', delivery: 'not_sent', retry_safe: true }, times: 1 };
    await clickUrgentAndConfirm(page);
    await waitFor(() => page.evaluate(() => /code:/.test(document.getElementById('confirmMsg').textContent)), 4000);
    const has = await page.evaluate(() => !![...document.querySelectorAll('#confirmOverlay .brief-action-btn')].find(x => /Refresh this card/.test(x.textContent) && x.offsetParent !== null));
    check(!has, 'urgent_lookup_unavailable: no refresh button');
    const claim = S.diag.slice(-1)[0] || {};
    check(claim.code === 'urgent_lookup_unavailable' && claim.status === 503, 'urgent_lookup_unavailable: logged with its code and 503');
  });

  await scenario('(d) the stamp read failing after the save still lets the ping through', async (S, page) => {
    S.behave['read:card'] = { mode: 'reject', times: 1 };
    await setTweaks(page);
    await sleep(2500);
    check(S.log.filter(l => l.key === 'READ card p_t1').length === 1, 'the post-save read was attempted and failed');
    await clickUrgentAndConfirm(page);
    check(await waitFor(() => urgentRequests(S).length === 1), 'the ping was sent');
    check(/http 202/.test((lastUrgent(S) || {}).outcome || ''), 'and accepted (the pre-ping read supplied the stamp): ' + (lastUrgent(S) || {}).outcome);
  });

  await scenario('(d2) both reads failing: the ping is still sent, not blocked', async (S, page) => {
    S.behave['read:card'] = { mode: 'reject', times: 10 };
    await setTweaks(page);
    await sleep(2500);
    await clickUrgentAndConfirm(page);
    check(await waitFor(() => urgentRequests(S).length === 1), 'the ping request was sent with what the page held');
  });

  await scenario('(d3) an unreadable card (HTTP 500) is treated as could not check', async (S, page) => {
    S.behave['read:card'] = { mode: 'http', status: 500, times: 10 };
    await setTweaks(page);
    await sleep(2500);
    await clickUrgentAndConfirm(page);
    check(await waitFor(() => urgentRequests(S).length === 1), 'the ping request was sent');
  });

  /* (e) Samples: the same card, the same rules, the other table and save queue. */
  async function samplesScenario(name, fn) {
    console.log('\n# ' + name);
    const S = await createEnv();
    try {
      const page = await S.newPage();
      await S.openSamples(page);
      await fn(S, page);
    } catch (error) {
      failures.push(name + ': threw ' + String(error && error.stack || error).split('\n').slice(0, 3).join(' | '));
      console.log('  FAIL  threw ' + String(error && error.message || error));
    } finally { await S.close(); }
  }
  const SCARD = '.cal-card[data-pid="s_t1"]';
  const setSampleTweaks = async page => {
    await page.click(SCARD + ' .cal-fld-substatus-trigger >> nth=0');
    await page.click('.cal-fld-status-item.cal-fld-status-tweaks-needed');
  };
  const clickSampleUrgent = async page => {
    await page.click(SCARD + ' .cal-urgent-btn');
    await waitFor(() => page.evaluate(() => document.getElementById('confirmOverlay').classList.contains('active')), 4000);
    await page.click('#confirmYes');
  };
  for (const delay of [800, 3000]) {
    await samplesScenario('(e) Samples: URGENT ' + delay + ' ms after setting Tweaks Needed', async (S, page) => {
      await setSampleTweaks(page);
      await sleep(delay);
      await clickSampleUrgent(page);
      check(await waitFor(() => urgentRequests(S).length === 1), 'one ping request reached the gateway');
      const entry = lastUrgent(S);
      check(entry && Date.parse(sentStamp(entry)) === Date.parse(S.card('s_t1').video_status_at), 'the request carries the stamp the database holds');
      check(entry && /http 202/.test(entry.outcome), 'accepted: ' + (entry && entry.outcome));
    });
  }
  await samplesScenario('(e2) Samples: a status save adopts the stamp without a reload', async (S, page) => {
    await setSampleTweaks(page);
    await waitFor(() => page.evaluate(() => Date.parse(sxrState.posts.find(x => x.id === 's_t1').video_status_at) > Date.parse('2026-10-01T09:00:01.000Z')), 6000);
    const at = await page.evaluate(() => sxrState.posts.find(x => x.id === 's_t1').video_status_at);
    check(Date.parse(at) === Date.parse(S.card('s_t1').video_status_at), 'the sample on screen holds the database stamp (' + at + ')');
    check(S.log.filter(l => l.key === 'READ card s_t1').length === 1, 'one single-card read of the sample row');
  });
  await samplesScenario('(e3) Samples: the sample changed under the person, then a refused ping is refreshed', async (S, page) => {
    await setSampleTweaks(page);
    await sleep(2500);
    S.setCardField('s_t1', { video_status: 'For SMM Approval' }, 'teammate');
    await clickSampleUrgent(page);
    await sleep(900);
    check(urgentRequests(S).length === 0, 'nothing was sent for a sample that moved on');
    const shown = await modalText(page);
    check(shown && /For SMM Approval/.test(shown.text), 'the message says what it says now: ' + JSON.stringify(shown));
    // The notice offers the refresh; one click puts the new status on the sample.
    await page.evaluate(() => [...document.querySelectorAll('#confirmOverlay .brief-action-btn')].find(x => /Refresh this card/.test(x.textContent)).click());
    await waitFor(() => page.evaluate(() => sxrState.posts.find(x => x.id === 's_t1').video_status === 'For SMM Approval'), 4000);
    check(await page.evaluate(() => sxrState.posts.find(x => x.id === 's_t1').video_status) === 'For SMM Approval', 'the sample now shows the status the database holds');
    // A teammate sends it back for tweaks: a new round, which the ping now supports after the next refresh/read.
    S.setCardField('s_t1', { video_status: 'Tweaks Needed' }, 'teammate');
    S.behave['read:card'] = { mode: 'reject', times: 1 };
    await page.evaluate(() => { const p = sxrState.posts.find(x => x.id === 's_t1'); p.video_status = 'Tweaks Needed'; _sxrUpdateCardStatusDisplay('s_t1'); });
    await waitFor(() => page.evaluate(sel => !!document.querySelector(sel), SCARD + ' .cal-urgent-btn'), 3000);
    await clickSampleUrgent(page);
    check(await waitFor(() => urgentRequests(S).length === 1), 'the ping was sent although the pre-send read failed (permissive)');
    check(/http 409 urgent_target_changed/.test((lastUrgent(S) || {}).outcome || ''), 'the stale stamp was refused: ' + (lastUrgent(S) || {}).outcome);
    await waitFor(() => S.diag.some(d => d.operation === 'urgent_ping'), 5000);
    const claim = S.diag.filter(d => d.operation === 'urgent_ping').slice(-1)[0] || {};
    check(claim.code === 'urgent_target_changed' && claim.status === 409 && claim.surface === 'sxr', 'logged with the real code, status 409 and the samples surface: ' + JSON.stringify([claim.code, claim.status, claim.surface]));
    await page.evaluate(() => [...document.querySelectorAll('#confirmOverlay .brief-action-btn')].find(x => /Refresh this card/.test(x.textContent)).click());
    await waitFor(() => page.evaluate(at => Date.parse(sxrState.posts.find(x => x.id === 's_t1').video_status_at) === Date.parse(at), S.card('s_t1').video_status_at), 4000);
    await clickSampleUrgent(page);
    check(await waitFor(() => urgentRequests(S).length === 2), 'after the refresh the next ping went out');
    check(/http 202/.test((lastUrgent(S) || {}).outcome || ''), 'and was accepted: ' + (lastUrgent(S) || {}).outcome);
  });

  if (failures.length) {
    console.log('\nurgent-ping-fresh-round-browser: ' + failures.length + ' failure(s)');
    failures.forEach(f => console.log(' - ' + f));
    process.exit(1);
  }
  console.log('\nurgent-ping-fresh-round-browser: all checks passed');
})().catch(error => { console.error(error); process.exit(1); });
