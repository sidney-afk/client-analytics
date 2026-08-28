// p77 — Linear sub-issue link validation (_calLinearCommit guards). Pasting a
// non-Linear string (a note/blob) must be REJECTED with a disclaimer and never
// stored; a real VID- link saves to the video slot; a GRA- link pasted into the
// VIDEO slot must prompt (overridable), not silently save. Guards against the
// "weird text sitting in the link slot" bug.
//
// 2026-08-25: the GRAPHIC half inverted. Graphics is SyncView-authoritative, so
// the URL is no longer the write target there and pasting one manufactures a
// card whose status can never be changed (native_link_required). The slot is
// sealed, and this probe now asserts the REFUSAL where it used to assert the
// save — plus the exemption that makes the seal survivable: clearing an
// existing link still works, because that is the repair for every half-linked
// card the old behaviour produced.
//
// _calLinearCommit is ASYNC as of the same change (it reads live authority
// before saving), so every call here is awaited. Snapshotting window.__notified
// straight after an unawaited call reads it before the guard has run.
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_linkval_' + TS;
const BLOB = 'just a note, not a url at all ' + TS;
const VID = 'https://linear.app/synchro-social/issue/VID-7' + (TS % 9000 + 1000) + '/v';
const GRA = 'https://linear.app/synchro-social/issue/GRA-7' + (TS % 9000 + 1000) + '/g';

// commit a value through the REAL handler, controlling the confirm/notify outcome
const commit = (page, pid, comp, value, confirmMode /* 'accept'|'cancel'|undefined */) => page.evaluate(async (a) => {
  window.__notified = false; window.__confirmed = false;
  window.showNotify = () => { window.__notified = true; };
  window.showConfirm = (t, m, onYes) => { window.__confirmed = true; if (a.confirmMode === 'accept' && typeof onYes === 'function') onYes(); };
  // AWAITED: the handler now consults live authority before it saves, so a
  // synchronous snapshot would read __notified before the guard has decided.
  await _calLinearCommit({ value: a.value, dataset: {} }, a.pid, a.comp);
  return { notified: window.__notified, confirmed: window.__confirmed };
}, { pid, comp, value, confirmMode });

// Which system owns each team right now, read from the page rather than assumed
// — this probe must follow an authority flip instead of going red on one.
const authority = (page) => page.evaluate(() => _writeUiRefreshAuthority());

const vid = async () => { const r = await Q.rawRow(PID, 'linear_issue_id'); return String(r.linear_issue_id || ''); };
const gra = async () => { const r = await Q.rawRow(PID, 'graphic_linear_issue_id'); return String(r.graphic_linear_issue_id || ''); };

(async () => {
  const S = Q.makeOk('P77 linear link validation');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'LINKVAL ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'In Progress', status: 'In Progress', linear_issue_id: '', graphic_linear_issue_id: '',
      thumbnail_url: 'https://via.placeholder.com/320x180.png' });
    await Q.pollRaw(PID, r => r.name === 'LINKVAL ' + TS, 'name');
    await Q.waitForPost(smm, PID);

    // 1) a non-Linear blob into the video slot → rejected + disclaimer, nothing saved
    const r1 = await commit(smm, PID, 'video', BLOB);
    await smm.waitForTimeout(2000);
    S.ok(r1.notified === true, 'blob paste → disclaimer shown ("that isn\'t a Linear link")');
    S.ok((await vid()) === '', 'blob paste → nothing written to the video link slot');

    // 2) a real VID- link into the video slot → saved
    await commit(smm, PID, 'video', VID);
    await Q.pollRaw(PID, r => (r.linear_issue_id || '') === VID, 'linear_issue_id', 8000);
    S.ok((await vid()) === VID, 'valid VID- link saves to the video slot');

    // 3) a GRA- link into the VIDEO slot, user CANCELS the prompt → not saved (video keeps the VID- link)
    const r3 = await commit(smm, PID, 'video', GRA, 'cancel');
    await smm.waitForTimeout(2000);
    S.ok(r3.confirmed === true, 'GRA- link in the video slot → wrong-slot prompt fired');
    S.ok((await vid()) === VID, 'wrong-slot prompt CANCELLED → video link unchanged (no silent overwrite)');

    // 4) same GRA- link into the video slot, user OVERRIDES → saved
    await commit(smm, PID, 'video', GRA, 'accept');
    await Q.pollRaw(PID, r => (r.linear_issue_id || '') === GRA, 'linear_issue_id', 8000);
    S.ok((await vid()) === GRA, 'wrong-slot prompt ACCEPTED → override saves it');

    // 5) the GRAPHIC slot follows AUTHORITY. While graphics is SyncView-owned the
    //    URL is not the write target, so a paste there is refused with a
    //    disclaimer and nothing is stored. If graphics is ever flipped back to
    //    Linear the same paste must save again — so the probe asks the page
    //    which world it is in rather than hardcoding one.
    const auth = await authority(smm);
    const graphicsSealed = !!auth && auth.graphics === 'syncview';
    const r5 = await commit(smm, PID, 'graphic', GRA);
    await smm.waitForTimeout(2000);
    if (graphicsSealed) {
      S.ok((await gra()) === '', 'graphics is SyncView-owned → a GRA- paste is REFUSED and nothing is stored');
      S.ok(r5.notified === true, 'and the person is told why, rather than the paste silently vanishing');

      // 6) the exemption that makes the seal survivable. Seed a link the way the
      //    old behaviour would have left one, then prove staff can still remove
      //    it — that empty-value path is the repair for every half-linked card.
      await Q.up({ id: PID, graphic_linear_issue_id: GRA });
      await Q.pollRaw(PID, r => (r.graphic_linear_issue_id || '') === GRA, 'graphic_linear_issue_id', 8000);
      // The seed lands in the DB, but _calLinearCommit computes `changed`
      // against the PAGE's in-memory post — commit before the page has picked
      // the link up and the clear no-ops as "no change" (this exact race kept
      // the nightly red from the assertion's first run). Wait until the page
      // itself carries the link before driving the clear. (The predicate is
      // re-eval'd in-page without its closure, so it can't reference GRA —
      // non-empty is sufficient: this seed is the slot's only writer.)
      const seen = await Q.waitForPost(smm, PID, p => String(p.graphic_linear_issue_id || '') !== '');
      S.ok(seen.found === true, 'page picked up the seeded graphic link (precondition for the clear)');
      await commit(smm, PID, 'graphic', '');
      await Q.pollRaw(PID, r => (r.graphic_linear_issue_id || '') === '', 'graphic_linear_issue_id', 8000);
      S.ok((await gra()) === '', 'CLEARING a sealed graphic link still commits — the repair path stays open');
    } else {
      await Q.pollRaw(PID, r => (r.graphic_linear_issue_id || '') === GRA, 'graphic_linear_issue_id', 8000);
      S.ok((await gra()) === GRA, 'graphics is Linear-owned → a valid GRA- link saves to the graphic slot');
      S.ok(r5.notified === false && r5.confirmed === false, 'correct GRA→graphic paste raised no disclaimer/prompt');
    }

    S.ok(smm._errs.length === 0, 'no JS errors (' + JSON.stringify(smm._errs.slice(0, 3)) + ')');
  } finally {
    try { await Q.up({ id: PID, status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
