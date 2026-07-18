// ot4_t0_client_edge_conditions.js — TIER 0 edge conditions on the client
// share links, all through real clicks (P1-P3 samples; P4 samples + calendar):
//   P1 TOKEN — the ?t= link variant loads and its approve lands (the legacy
//      writer is un-gated; the token only rides edge-function calls — freeze
//      contract: existing links keep working, with or without token).
//   P2 MOBILE — 390×844 touch viewport: controls render inside the viewport,
//      a typed request-change lands in the DB.
//   P3 SLOW NETWORK — the save round-trip delayed 4 s: the panel shows a real
//      saving state (buttons disabled), no premature success, then the save
//      lands and the UI settles with no error.
//   P4 FAILURE — each surface's save endpoint forced to 500: the optimistic
//      Tweaks Needed flip rolls back to an active Client Approval panel, the
//      failure is visible, the exact typed draft and enabled Request change
//      retry remain, and DB truth stays untouched. Once the route recovers, a
//      same-page resend (without retyping) lands exactly once.
'use strict';
const H = require('./ot4_lib.js');
const { launch, client, clientCal, up, upCal, archiveSafe, archiveCalSafe, appErrs } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();
const POLL = 35000;
const APPROVAL_STAMP = '2026-07-18T00:00:00.000Z';
const SXR_KEYS = ['tok', 'mob', 'slow', 'fail'];
const IDS = {
  tok: `sr_ot4e_tok_${TS}`,
  mob: `sr_ot4e_mob_${TS}`,
  slow: `sr_ot4e_slow_${TS}`,
  fail: `sr_ot4e_fail_${TS}`,
  failCal: `p_ot4e_failcal_${TS}`
};
const ISSUES = {
  fail: `https://linear.app/sidtest/issue/GRA-${TS}/ot4-samples-failure`,
  failCal: `https://linear.app/sidtest/issue/GRA-${TS + 1}/ot4-calendar-failure`
};
const NAMES = {
  tok: `OT4 Token ${TS}`,
  mob: `OT4 Mobile ${TS}`,
  slow: `OT4 SlowNet ${TS}`,
  fail: `OT4 FailSave ${TS}`,
  failCal: `OT4 Cal FailSave ${TS}`
};
const TOMORROW = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);

function seed(key, i) {
  const failure = key === 'fail';
  up({ id: IDS[key], name: NAMES[key], order_index: i + 1,
    video_status: failure ? 'In Progress' : 'Client Approval',
    graphic_status: 'Client Approval',
    status: failure ? 'In Progress' : 'Client Approval',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    graphic_linear_issue_id: failure ? ISSUES.fail : '',
    client_graphic_approved_at: failure ? APPROVAL_STAMP : '',
    kasper_approved_at: failure ? APPROVAL_STAMP : '' });
}

function seedCalendarFailure() {
  upCal({ id: IDS.failCal, name: NAMES.failCal, platforms: 'youtube', scheduled_date: TOMORROW,
    video_status: 'In Progress', graphic_status: 'Client Approval',
    caption_status: 'In Progress', status: 'In Progress',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    asset_url: 'https://example.com/ot4-failure.mp4',
    graphic_linear_issue_id: ISSUES.failCal,
    client_graphic_approved_at: APPROVAL_STAMP,
    kasper_approved_at: APPROVAL_STAMP });
}

function tweakBodies(value) {
  let rows = value;
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows || '[]'); } catch { rows = []; }
  }
  return Array.isArray(rows) ? rows.map(row => String(row && row.body || '')) : [];
}

function matchingNotifications(issueUrl, body) {
  return H.linearCalls().filter(call =>
    call && call.path === 'linear-add-comment' &&
    call.payload && call.payload.issue === issueUrl && call.payload.body === body
  );
}

function matchingStatusPushes(issueUrl) {
  return H.linearCalls().filter(call =>
    call && call.path === 'linear-set-status' &&
    call.payload && call.payload.issue === issueUrl && call.payload.status === 'Tweaks Needed'
  );
}

async function exerciseRequestFailure(opts) {
  const { browser, label, openPage, routePattern, id, name, row, issueUrl, initialStatus } = opts;
  const comp = 'graphic';
  const statusKey = comp + '_status';
  const tweaksKey = comp + '_tweaks';
  const submittedBody = `OT4 ${label} fail-then-retry ${TS}`;
  const rawDraft = `  \n${submittedBody}\n\n  `;
  H.resetLinearCalls();
  const p = await openPage(browser);
  let block = true;
  let blockedWrites = 0;
  await p.route(routePattern, async (route) => {
    if (block) {
      blockedWrites++;
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '{"ok":false}'
      });
    }
    await route.fallback();
  });

  const clicked = await H.clientAct(p, name, comp, 'request', rawDraft);
  t(clicked === 'ok', `P4/${label}: request-change clicked while backend is down`, clicked);

  // Wait for the save promise to settle. Inspect both the actual rendered
  // controls and the surface's in-memory row: a hidden error alone is not a
  // client recovery path.
  const st = await p.waitForFunction((args) => {
    const [surface, pid, n, comp, expectedDraft] = args;
    const key = pid + '|' + comp;
    let current = null;
    let detected = '';
    let saving = false;
    try {
      if (surface === 'samples') {
        current = (typeof sxrState !== 'undefined' && (sxrState.posts || []).find(x => x.id === pid)) || null;
        detected = (typeof _sxrReviewState !== 'undefined' && _sxrReviewState.errors[key]) || '';
        saving = !!(typeof _sxrReviewState !== 'undefined' && _sxrReviewState.saving[key]);
      } else {
        current = (typeof calState !== 'undefined' && (calState.posts || []).find(x => x.id === pid)) || null;
        detected = (typeof _calReviewState !== 'undefined' && _calReviewState.errors[key]) || '';
        saving = !!(typeof _calReviewState !== 'undefined' && _calReviewState.saving[key]);
      }
    } catch {}
    if (saving || !detected) return false;
    const card = [...document.querySelectorAll('.cal-review-card')]
      .find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    const panel = card && card.querySelector(`.cal-review-panel[data-comp="${comp}"]`);
    const textarea = panel && panel.querySelector('.cal-review-textarea');
    const retry = panel && panel.querySelector('.cal-review-tweak-btn');
    const error = panel && panel.querySelector('.cal-review-panel-err');
    let errorVisible = false;
    if (error) {
      const rect = error.getBoundingClientRect();
      const css = getComputedStyle(error);
      errorVisible = rect.width > 0 && rect.height > 0 && css.display !== 'none' && css.visibility !== 'hidden';
    }
    return {
      detected,
      localStatus: current && current[comp + '_status'],
      localClientApprovalStamp: current && current['client_' + comp + '_approved_at'],
      localKasperApprovalStamp: current && current.kasper_approved_at,
      card: !!card,
      panel: !!panel,
      panelState: panel && panel.dataset.state,
      errorText: error ? error.textContent.trim() : '',
      errorVisible,
      textareaValue: textarea ? textarea.value : null,
      textareaReadonly: textarea ? textarea.readOnly : null,
      retryPresent: !!retry,
      retryEnabled: !!(retry && !retry.disabled),
      exactDraft: !!(textarea && textarea.value === expectedDraft)
    };
  }, [label, id, name, comp, rawDraft], { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);

  t(blockedWrites > 0, `P4/${label}: failure injection intercepted the source save`, blockedWrites);
  t(!!st && st.localStatus === 'Client Approval' && st.card && st.panel &&
      st.panelState === 'pending' && st.textareaReadonly === false,
    `P4/${label}: failed save rolls back to the review-active Client Approval UI`, JSON.stringify(st));
  t(!!st && st.localClientApprovalStamp === APPROVAL_STAMP &&
      st.localKasperApprovalStamp === APPROVAL_STAMP,
    `P4/${label}: failed save restores optimistic approval-stamp clears`, JSON.stringify(st));
  t(!!st && st.errorVisible && /500|fail|error/i.test(st.errorText),
    `P4/${label}: client sees the save failure`, st && st.errorText);
  t(!!st && st.exactDraft,
    `P4/${label}: exact typed request remains in the composer`, st && st.textareaValue);
  t(!!st && st.retryPresent && st.retryEnabled,
    `P4/${label}: Request change is re-enabled for retry`, JSON.stringify(st));

  const mid = row(`${statusKey},status,${tweaksKey},client_${comp}_approved_at,kasper_approved_at`);
  const midBodies = tweakBodies(mid && mid[tweaksKey]);
  t(!!mid && mid[statusKey] === 'Client Approval' && mid.status === initialStatus &&
      !midBodies.includes(submittedBody) &&
      mid['client_' + comp + '_approved_at'] === APPROVAL_STAMP &&
      mid.kasper_approved_at === APPROVAL_STAMP,
    `P4/${label}: DB status and request text stay untouched before resend`, JSON.stringify(mid));
  await H.sleep(500);
  const failedNotifications = matchingNotifications(issueUrl, submittedBody);
  t(failedNotifications.length === 0,
    `P4/${label}: failed source save sends no premature team notification`, failedNotifications.length);
  const failedStatusPushes = matchingStatusPushes(issueUrl);
  t(failedStatusPushes.length === 0,
    `P4/${label}: failed source save sends no premature team status`, failedStatusPushes.length);

  // Recover the endpoint, then click the already-enabled button directly. Do
  // not call clientAct here: it would type again and weaken the draft-retention
  // proof this regression test exists to enforce.
  block = false;
  const resent = await p.evaluate((args) => {
    const [n, comp, expectedDraft] = args;
    const card = [...document.querySelectorAll('.cal-review-card')]
      .find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    const panel = card && card.querySelector(`.cal-review-panel[data-comp="${comp}"]`);
    const textarea = panel && panel.querySelector('.cal-review-textarea');
    const button = panel && panel.querySelector('.cal-review-tweak-btn');
    if (!textarea || textarea.value !== expectedDraft) return 'draft-missing';
    if (!button) return 'no-btn';
    if (button.disabled) return 'disabled';
    button.click();
    return 'ok';
  }, [name, comp, rawDraft]);
  t(resent === 'ok', `P4/${label}: preserved request re-sent without retyping`, resent);

  const successToast = await p.waitForFunction(() => {
    const text = (document.querySelector('.sv-toast') || { textContent: '' }).textContent.trim();
    return /change request sent/i.test(text) ? text : false;
  }, null, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => '');
  t(/change request sent/i.test(successToast),
    `P4/${label}: successful retry confirms the request reached the team`, successToast);

  const landed = await H.pollRow(
    () => row(`${statusKey},status,${tweaksKey},client_${comp}_approved_at,kasper_approved_at`),
    x => x[statusKey] === 'Tweaks Needed' && tweakBodies(x[tweaksKey]).includes(submittedBody) &&
      !String(x['client_' + comp + '_approved_at'] || '').trim() &&
      !String(x.kasper_approved_at || '').trim(),
    POLL
  );
  const occurrences = tweakBodies(landed && landed[tweaksKey])
    .filter(body => body === submittedBody).length;
  t(!!landed && landed[statusKey] === 'Tweaks Needed' && landed.status === 'Tweaks Needed' &&
      occurrences === 1,
    `P4/${label}: re-sent preserved request lands exactly once`, JSON.stringify(landed));
  t(!!landed && !String(landed['client_' + comp + '_approved_at'] || '').trim() &&
      !String(landed.kasper_approved_at || '').trim(),
    `P4/${label}: successful retry durably clears stale approval stamps`, JSON.stringify(landed));
  await H.poll(() =>
    matchingNotifications(issueUrl, submittedBody).length > 0 &&
    matchingStatusPushes(issueUrl).length > 0,
  10000, 200);
  await H.sleep(500);
  const notifications = matchingNotifications(issueUrl, submittedBody);
  t(notifications.length === 1,
    `P4/${label}: successful retry notifies the linked team issue exactly once`, notifications.length);
  const statusPushes = matchingStatusPushes(issueUrl);
  t(statusPushes.length === 1,
    `P4/${label}: successful retry mirrors the linked team status exactly once`, statusPushes.length);
  t(appErrs(p).length === 0, `P4/${label}: 0 app JS errors`, (appErrs(p)[0] || ''));
  await p.context().close();
}

(async () => {
  const browser = await launch();
  try {
    SXR_KEYS.forEach((k, i) => seed(k, i));
    seedCalendarFailure();
    await H.pollRow(
      () => H.rowSxr(IDS.fail, 'id,status,graphic_status,client_graphic_approved_at,kasper_approved_at'),
      r => r.status === 'In Progress' && r.graphic_status === 'Client Approval' &&
        r.client_graphic_approved_at === APPROVAL_STAMP && r.kasper_approved_at === APPROVAL_STAMP
    );
    await H.pollRow(
      () => H.rowCal(IDS.failCal, 'id,status,graphic_status,client_graphic_approved_at,kasper_approved_at'),
      r => r.status === 'In Progress' && r.graphic_status === 'Client Approval' &&
        r.client_graphic_approved_at === APPROVAL_STAMP && r.kasper_approved_at === APPROVAL_STAMP
    );

    // ---- P1: token link ----------------------------------------------------
    {
      const p = await client(browser, undefined, 'ot4-qa-token-' + TS);
      const a = await H.clientAct(p, NAMES.tok, 'video', 'approve');
      t(a === 'ok', 'P1: token link loads; approve clickable', a);
      const r = await H.pollRow(() => H.rowSxr(IDS.tok, 'video_status'), x => x.video_status === 'Approved', POLL);
      t(!!r && r.video_status === 'Approved', 'P1: approve via token link landed in DB');
      t(appErrs(p).length === 0, 'P1: 0 app JS errors', (appErrs(p)[0] || ''));
      await p.context().close();
    }

    // ---- P2: mobile viewport ----------------------------------------------
    {
      const p = await client(browser, undefined, undefined, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await H.expandReview(p, NAMES.mob);
      const fit = await p.evaluate((n) => {
        const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
        const b = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-tweak-btn');
        const ta = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-textarea');
        if (!b || !ta) return { ok: false };
        const rb = b.getBoundingClientRect(), rt = ta.getBoundingClientRect();
        return { ok: true, btnIn: rb.right <= 391 && rb.left >= -1 && rb.width > 0, taIn: rt.right <= 391 && rt.left >= -1 && rt.width > 0 };
      }, NAMES.mob);
      t(fit.ok && fit.btnIn && fit.taIn, 'P2: mobile 390px — composer + request button fit the viewport', JSON.stringify(fit));
      const a = await H.clientAct(p, NAMES.mob, 'video', 'request', 'OT4 mobile req ' + TS);
      t(a === 'ok', 'P2: mobile typed request-change clicked', a);
      const r = await H.pollRow(() => H.rowSxr(IDS.mob, 'video_status,video_tweaks'), x => x.video_status === 'Tweaks Needed', POLL);
      t(!!r && r.video_status === 'Tweaks Needed' && JSON.stringify(r.video_tweaks || '').includes('OT4 mobile req'), 'P2: mobile request-change landed with text');
      t(appErrs(p).length === 0, 'P2: 0 app JS errors', (appErrs(p)[0] || ''));
      await p.context().close();
    }

    // ---- P3: slow network --------------------------------------------------
    {
      const p = await client(browser);
      await p.route('**/sample-review-upsert*', async (route) => {
        await new Promise(r => setTimeout(r, 4000));
        await route.fallback();
      });
      await H.expandReview(p, NAMES.slow);
      const clicked = await p.evaluate((n) => {
        const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
        const b = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-approve-btn');
        if (!b || b.disabled) return 'no-btn';
        b.click(); return 'ok';
      }, NAMES.slow);
      t(clicked === 'ok', 'P3: approve clicked under a 4s-delayed network', clicked);
      // The repaint REPLACES the card node — re-query fresh from document. While
      // the slow save is in flight the acted panel must not offer a clickable
      // stale Approve (optimistic approved state or disabled control both count).
      const savingState = await p.waitForFunction((n) => {
        const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
        if (!card) return { gone: true };
        const b = card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-approve-btn');
        return (!b || b.disabled) ? { staleClickable: false } : false;
      }, NAMES.slow, { timeout: 2500 }).then(h => h.jsonValue()).catch(() => null);
      t(!!savingState, 'P3: during the slow save no stale clickable Approve remains (instant honest UI)', JSON.stringify(savingState));
      const r = await H.pollRow(() => H.rowSxr(IDS.slow, 'video_status'), x => x.video_status === 'Approved', POLL);
      t(!!r && r.video_status === 'Approved', 'P3: slow save still landed in DB');
      await H.sleep(1200);
      const ps = await H.panelState(p, NAMES.slow, 'video');
      t(!ps.error, 'P3: no error shown after the slow save settled', ps.error);
      t(appErrs(p).length === 0, 'P3: 0 app JS errors', (appErrs(p)[0] || ''));
      await p.context().close();
    }

    // ---- P4: request-change failure injection, both client surfaces --------
    await exerciseRequestFailure({
      browser,
      label: 'samples',
      openPage: client,
      routePattern: '**/sample-review-upsert*',
      id: IDS.fail,
      name: NAMES.fail,
      row: cols => H.rowSxr(IDS.fail, cols),
      issueUrl: ISSUES.fail,
      initialStatus: 'In Progress'
    });
    await exerciseRequestFailure({
      browser,
      label: 'calendar',
      openPage: clientCal,
      routePattern: '**/calendar-upsert*',
      id: IDS.failCal,
      name: NAMES.failCal,
      row: cols => H.rowCal(IDS.failCal, cols),
      issueUrl: ISSUES.failCal,
      initialStatus: 'In Progress'
    });
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    let clean = true;
    for (const key of SXR_KEYS) if (!archiveSafe(IDS[key])) clean = false;
    if (!archiveCalSafe(IDS.failCal)) clean = false;
    t(clean, 'cleanup: all 5 seeds archived + verified');
  }
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
