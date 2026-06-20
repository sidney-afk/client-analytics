// p28 — LINEAR SYNC ROUTING (the user's top priority). Verifies that status changes and
// notes route to the CORRECT Linear sub-issue — without mutating real Linear: we intercept
// the linear-set-status / linear-add-comment webhooks, capture the payloads, and fulfill ok.
//   - video/graphic status change → push {issue:<that comp's issue>, status} to linear-set-status
//   - caption/title status change → NO Linear push
//   - video/graphic note → push {issue, body} to linear-add-comment
//   - caption note → NO Linear push
//   - cross-client safety: every captured issue is SIDNEY's card's test issue, never another's
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_lin_' + TS;
const VURL = 'https://linear.app/sidtest/issue/SIDV-' + TS;     // fake video issue (no real Linear)
const GURL = 'https://linear.app/sidtest/issue/SIDG-' + TS;     // fake graphic issue
const SET = 'https://synchrosocial.app.n8n.cloud/webhook/linear-set-status';
const ADD = 'https://synchrosocial.app.n8n.cloud/webhook/linear-add-comment';

(async () => {
  const S = Q.makeOk('P28 linear-sync');
  const browser = await Q.launch();
  // SMM page with interception of the two Linear webhooks
  const PW = require('/opt/node22/lib/node_modules/playwright');
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('syncview_auth_v1', 'ok'); } catch (e) {} });
  const setCalls = [], addCalls = [];
  await ctx.route('**/webhook/linear-set-status', async (route) => {
    try { setCalls.push(JSON.parse(route.request().postData() || '{}')); } catch (e) { setCalls.push({ parseErr: true }); }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  await ctx.route('**/webhook/linear-add-comment', async (route) => {
    try { addCalls.push(JSON.parse(route.request().postData() || '{}')); } catch (e) { addCalls.push({ parseErr: true }); }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  const smm = await ctx.newPage();
  smm._errs = [];
  smm.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) smm._errs.push(m.text()); });
  smm.on('pageerror', e => smm._errs.push(String(e && e.message)));

  const waitFor = async (arr, n, ms = 14000) => { const t = Date.now(); while (Date.now() - t < ms) { if (arr.length >= n) return true; await new Promise(x => setTimeout(x, 400)); } return false; };

  try {
    await Q.up({ id: PID, name: 'LIN ' + TS, platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress', status: 'In Progress',
      linear_issue_id: VURL, graphic_linear_issue_id: GURL });
    // backend may blank a colliding link; these are unique so they persist
    await Q.pollRaw(PID, r => String(r.linear_issue_id || '').includes('SIDV-' + TS), 'linear_issue_id', 14000);

    await smm.goto('http://localhost:8000/index.html?v2debug=1#calendar/sidneylaruel', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await smm.waitForFunction(() => window.calV2Status && window.calV2Status().subscribed, { timeout: 20000 }).catch(() => {});
    await smm.waitForTimeout(2500);
    await Q.waitForPost(smm, PID);

    // 1) video status change → linear-set-status {issue:VURL, status:'Tweaks Needed'}
    await smm.evaluate((pid) => { try { _calStatusPick(pid, 'Tweaks Needed', 'video'); } catch (e) {} }, PID);
    await waitFor(setCalls, 1);
    const vcall = setCalls.find(c => String(c.issue || '').includes('SIDV-' + TS));
    S.ok(!!vcall, 'video status change pushed to Linear (issue=' + (vcall && vcall.issue) + ')');
    S.ok(vcall && vcall.status === 'Tweaks Needed', 'video push carries the new status (status=' + (vcall && vcall.status) + ')');

    // 2) graphic status change → linear-set-status {issue:GURL, ...}
    await smm.evaluate((pid) => { try { _calStatusPick(pid, 'For SMM Approval', 'graphic'); } catch (e) {} }, PID);
    await waitFor(setCalls, 2);
    const gcall = setCalls.find(c => String(c.issue || '').includes('SIDG-' + TS));
    S.ok(!!gcall, 'graphic status change pushed to the GRAPHIC Linear issue (issue=' + (gcall && gcall.issue) + ')');

    // 3) caption status change → NO Linear push
    const beforeCap = setCalls.length;
    await smm.evaluate((pid) => { try { _calStatusPick(pid, 'Kasper Approval', 'caption'); } catch (e) {} }, PID);
    await smm.waitForTimeout(6000);
    S.ok(setCalls.length === beforeCap, 'caption status change does NOT push to Linear (calls ' + beforeCap + '→' + setCalls.length + ')');

    // 4) video NOTE → linear-add-comment {issue:VURL, body}
    await smm.evaluate((a) => {
      openCalComments(a.pid); _calComposeComp = 'video'; _calComposeIsTweak = false;
      const ta = document.getElementById('calCommentComposer'); if (ta) ta.value = a.body;
      _calSubmitComposer();
    }, { pid: PID, body: 'VIDEO-NOTE-' + TS });
    await waitFor(addCalls, 1);
    const vnote = addCalls.find(c => String(c.body || '').includes('VIDEO-NOTE-' + TS));
    S.ok(!!vnote, 'video note pushed to Linear');
    S.ok(vnote && String(vnote.issue || '').includes('SIDV-' + TS), 'video note routed to the VIDEO issue (issue=' + (vnote && vnote.issue) + ')');

    // 5) caption NOTE → NO Linear push
    const beforeCapNote = addCalls.length;
    await smm.evaluate((a) => {
      openCalComments(a.pid); _calComposeComp = 'caption'; _calComposeIsTweak = false;
      const ta = document.getElementById('calCommentComposer'); if (ta) ta.value = a.body;
      _calSubmitComposer();
    }, { pid: PID, body: 'CAPTION-NOTE-' + TS });
    await smm.waitForTimeout(6000);
    S.ok(addCalls.length === beforeCapNote, 'caption note does NOT push to Linear (calls ' + beforeCapNote + '→' + addCalls.length + ')');

    // 6) cross-client safety: every captured issue is Sidney's test issue
    const allIssues = [...setCalls, ...addCalls].map(c => String(c.issue || ''));
    S.ok(allIssues.every(u => u.includes('SIDV-' + TS) || u.includes('SIDG-' + TS)), 'every Linear call targeted Sidney\'s own issue (no cross-client leak): ' + JSON.stringify([...new Set(allIssues)]));
    S.ok(smm._errs.length === 0, 'SMM: 0 JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
    console.log('captured set:', JSON.stringify(setCalls), '| add:', JSON.stringify(addCalls));
  } finally {
    // tombstone notes + archive
    const row = await Q.rawRow(PID, 'video_tweaks,caption_tweaks');
    await Q.up({ id: PID, status: 'Archived' });
    await browser.close();
  }
  process.exit(S.done());
})();
