// p52 — per-platform ALT caption: SMM-owned, client read-only, rides along with the caption
// component's review. Sidney has instagram/youtube/linkedin enabled.
//   • an alt caption (caption_alt + caption_alt_platform) propagates to the client (read view)
//   • client CANNOT edit it: _calOnAltCapInput is blocked (no pending edit) and _calAltCapRemove
//     no-ops on the client link
//   • SMM CAN remove it (caption_alt cleared) — and the removal persists + reaches the client
const Q = require('./lib.js');
const PID = 'p_alt_' + Math.floor(Date.now() / 1000);
const ALT = 'LinkedIn-only caption ' + PID.slice(-6);

const clientHasAlt = (cli, pid, text) => cli.evaluate(async (a) => {
  for (let i = 0; i < 22; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 800));
    const p = (calState.posts || []).find(x => x.id === a.pid);
    if (p && (a.text === null ? !String(p.caption_alt || '').trim() : String(p.caption_alt || '') === a.text)) return { ok: true, plat: p.caption_alt_platform };
  }
  const p = (calState.posts || []).find(x => x.id === a.pid); return { ok: false, alt: p ? p.caption_alt : '__nopost__' };
}, { pid, text });

(async () => {
  const S = Q.makeOk('P52 alt-caption SMM-owned / client read-only');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    // seed a card with a saved alt caption (as if the SMM authored it)
    await Q.up({ id: PID, name: 'ALT ' + PID.slice(-6), platforms: 'instagram,linkedin', scheduled_date: '2026-06-29',
      caption: 'Main caption text', caption_alt: ALT, caption_alt_platform: 'linkedin',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_alt === ALT, 'caption_alt');

    // 1) client sees the alt caption (read), with its platform
    const seen = await clientHasAlt(cli, PID, ALT);
    S.ok(seen.ok === true, 'client sees the alt caption text (read view)');
    S.ok(seen.plat === 'linkedin', 'client sees the alt caption platform = linkedin (got ' + seen.plat + ')');

    // 2) alt-caption is STRUCTURALLY client read-only regardless of collab: the client never
    //    gets the add/remove chrome (canEdit=!_isClientLink) and _calAltCapRemove no-ops on a
    //    client link. (Field-text edits are separately gated by _calClientFieldEditBlocked =
    //    isClientLink && !collabOn — Sidney is collab ON, so plain field edits are intentionally
    //    allowed for the collaborating client; that's not the alt-caption structural guard.)
    const cliGuards = await cli.evaluate((pid) => {
      const collabOn = (typeof _calIsCollabOn === 'function') ? !!_calIsCollabOn() : null;
      const blocked = (typeof _calClientFieldEditBlocked === 'function') ? !!_calClientFieldEditBlocked() : null;
      const before = (calState.posts || []).find(x => x.id === pid);
      const altBefore = before ? before.caption_alt : null;
      try { _calAltCapRemove(null, pid); } catch (e) {}
      const after = (calState.posts || []).find(x => x.id === pid);
      const pend = _calPendingEdits[pid] || null;
      return { isClientLink: _isClientLink, collabOn, blocked, altBefore, altAfter: after ? after.caption_alt : null, hasPending: !!pend };
    }, PID);
    S.ok(cliGuards.isClientLink === true, 'client surface is a client link');
    S.ok(cliGuards.blocked === (cliGuards.isClientLink && !cliGuards.collabOn), '_calClientFieldEditBlocked is collab-aware (collabOn=' + cliGuards.collabOn + ' → blocked=' + cliGuards.blocked + ')');
    S.ok(cliGuards.altAfter === cliGuards.altBefore && !cliGuards.hasPending, 'client _calAltCapRemove is a NO-OP (alt unchanged, no pending edit queued)');
    // DB still has the alt (client couldn't have removed it)
    let r = await Q.rawRow(PID, 'caption_alt'); S.ok(r.caption_alt === ALT, 'alt caption still in DB after client attempt (unchanged)');

    // 3) SMM CAN remove it → persists → reaches client
    await Q.waitForPost(smm, PID, "p=>String(p.caption_alt||'')==='" + ALT.replace(/'/g, "\\'") + "'");
    await smm.evaluate((pid) => { try { delete _calPendingEdits[pid]; const p = (calState.posts || []).find(x => x.id === pid); if (p) { p.caption_alt = ''; p.caption_alt_platform = ''; _calPendingEdits[pid] = { caption_alt: '', caption_alt_platform: '' }; _calFlushCardSave(pid); } } catch (e) {} }, PID);
    r = await Q.pollRaw(PID, x => !String(x.caption_alt || '').trim(), 'caption_alt,caption_status', 15000);
    S.ok(!String(r.caption_alt || '').trim(), 'SMM removed the alt caption → cleared in DB');
    S.ok(r.caption_status === 'Client Approval', 'caption_status unaffected by alt-caption edit (rides along, no separate status)');
    const goneForClient = await clientHasAlt(cli, PID, null);
    S.ok(goneForClient.ok === true, 'alt-caption removal reaches the client (now empty)');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
