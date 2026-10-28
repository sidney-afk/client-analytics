// p52 — per-platform ALT caption: SMM-owned, client read-only, rides along with the caption
// component's review. Sidney has instagram/youtube/linkedin enabled. Also the client's MAIN caption:
// editable and saved in Collaborative mode, read only without it (owner 2026-10-27).
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
  let r;
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

    // 2) alt-caption is client read-only, Collaborative mode or not. Since #2208 (merged in train #2209,
    //    owner 2026-10-18) a client's text is read only on an existing card; the owner reopened the CAPTION
    //    alone in Collaborative mode on 2026-10-27 (session Capedit). So with collab ON (the test client is
    //    collab ON) the handler gate _calClientFieldEditBlocked(el) lets 'caption' through and still blocks
    //    'caption_alt', 'cta' and 'scheduled_date'; with collab OFF it blocks all four. Collab OFF is checked by
    //    flipping the page's own setting for a moment, never by saving it.
    const cliGuards = await cli.evaluate((pid) => {
      const collabOn = (typeof _calIsCollabOn === 'function') ? !!_calIsCollabOn() : null;
      const gate = (id, fld) => (typeof _calClientFieldEditBlocked === 'function') ? !!_calClientFieldEditBlocked({ dataset: { pid: id, fld } }) : null;
      const fields = ['caption', 'caption_alt', 'cta', 'scheduled_date'];
      const on = {}, off = {};
      fields.forEach(f => { on[f] = gate(pid, f); });
      const saved = calState.settings.collab_mode;
      calState.settings.collab_mode = false;
      try { fields.forEach(f => { off[f] = gate(pid, f); }); } finally { calState.settings.collab_mode = saved; }
      const blankBlocked = gate('__blank__p52_probe', 'caption_alt');
      const before = (calState.posts || []).find(x => x.id === pid);
      const altBefore = before ? before.caption_alt : null;
      const typedHandler = typeof _calOnAltCapInput === 'function';
      try { _calOnAltCapInput({ dataset: { pid, fld: 'caption_alt' }, value: 'CLIENT EDIT ATTEMPT' }); } catch (e) {}
      try { _calAltCapRemove(null, pid); } catch (e) {}
      const after = (calState.posts || []).find(x => x.id === pid);
      const pend = _calPendingEdits[pid] || null;
      return { isClientLink: _isClientLink, collabOn, on, off, blankBlocked, typedHandler, altBefore, altAfter: after ? after.caption_alt : null, hasPending: !!pend };
    }, PID);
    S.ok(cliGuards.isClientLink === true, 'client surface is a client link');
    S.ok(cliGuards.collabOn === true, 'the test client is in Collaborative mode (collabOn=' + cliGuards.collabOn + ')');
    S.ok(cliGuards.on.caption === false, 'collab on: the client may edit the caption on an existing card (owner 2026-10-27; blocked=' + cliGuards.on.caption + ')');
    S.ok(cliGuards.on.caption_alt === true && cliGuards.on.cta === true && cliGuards.on.scheduled_date === true, 'collab on: alt caption, CTA and date stay blocked (' + JSON.stringify(cliGuards.on) + ')');
    S.ok(Object.values(cliGuards.off).every(b => b === true), 'collab off: caption, alt caption, CTA and date are all blocked (' + JSON.stringify(cliGuards.off) + ')');
    S.ok(cliGuards.blankBlocked === false, 'a blank "suggest a post" card stays editable for the client (blocked=' + cliGuards.blankBlocked + ')');
    S.ok(cliGuards.typedHandler && cliGuards.altAfter === cliGuards.altBefore && !cliGuards.hasPending, 'client alt-caption typing and _calAltCapRemove are NO-OPs (alt unchanged, no pending edit queued)');

    // 2b) collab on: a caption the client types on this existing card saves through the client link.
    const CLIENT_CAP = 'Main caption text, edited by the client ' + PID.slice(-6);
    await Q.waitForPost(cli, PID, "p=>String(p.caption||'')==='Main caption text'");
    await cli.evaluate((a) => { const el = { dataset: { pid: a.pid, fld: 'caption' }, value: a.text }; _calOnFieldInput(el); _calOnFieldBlur(el); }, { pid: PID, text: CLIENT_CAP });
    r = await Q.pollRaw(PID, x => x.caption === CLIENT_CAP, 'caption,caption_alt,caption_status', 15000);
    S.ok(r.caption === CLIENT_CAP, 'collab on: the client\'s caption edit is saved to the DB (got ' + JSON.stringify(String(r.caption || '').slice(0, 60)) + ')');
    S.ok(r.caption_status === 'Client Approval', 'collab on: a client caption edit leaves caption_status as it was (' + r.caption_status + ')');
    // DB still has the alt (client couldn't have removed it)
    r = await Q.rawRow(PID, 'caption_alt'); S.ok(r.caption_alt === ALT, 'alt caption still in DB after client attempt (unchanged)');

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
