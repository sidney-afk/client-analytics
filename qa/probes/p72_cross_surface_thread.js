// p72 — cross-surface comment thread via the REAL handlers (not seeded JSON):
// SMM posts a client-audience root on caption → the client replies → the SMM
// replies again → the SMM also drops an INTERNAL note. Verifies the cross-surface
// comment merge UNIONS every message (a client write and an SMM write to the same
// thread never clobber each other), and that the client surface sees the client
// thread but NOT the internal note (privacy via the live render path).
// (Kasper-authored comments are covered by p55 — a card at Client Approval is
// intentionally not in Kasper's review queue, so he can't comment on it here.)
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_thread_' + TS;
const ROOT = 'SMM-ROOT-' + TS, CREPLY = 'CLIENT-REPLY-' + TS, SREPLY = 'SMM-REPLY2-' + TS, SINT = 'SMM-INTERNAL-' + TS;

const postComment = (page, pid, parent, body, comp, audience) => page.evaluate(async (a) => {
  _calComposeComp = a.comp; _calComposeAudience = a.audience; _calComposeIsTweak = false;
  _calAppendComment(a.pid, a.parent, a.body);
  try { await _calFlushCardSave(a.pid); } catch (e) {}
}, { pid, parent, body, comp, audience });

const viewBodies = (page, pid) => page.evaluate(async (a) => {
  for (let i = 0; i < 14; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700));
    const p = (calState.posts || []).find(x => x.id === a.pid); if (p && (_calCommentsForView(p, 'caption') || []).some(c => /CLIENT-REPLY/.test(c.body || ''))) break; }
  const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return null;
  return (_calCommentsForView(p, 'caption') || []).filter(c => !c.deleted).map(c => c.body || '');
}, { pid });

(async () => {
  const S = Q.makeOk('P72 cross-surface thread');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const cli = await Q.clientPage(browser);
  try {
    await Q.up({ id: PID, name: 'THREAD ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'Client Approval', 'caption_status');
    await Q.waitForPost(smm, PID); await Q.waitForPost(cli, PID);

    // 1) SMM posts a client-audience root on the caption thread
    await postComment(smm, PID, null, ROOT, 'caption', 'client');
    const afterRoot = await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(ROOT), 'caption_tweaks');
    let list = []; try { list = JSON.parse(afterRoot.caption_tweaks || '[]'); } catch (e) {}
    const root = list.find(c => (c.body || '') === ROOT);
    S.ok(!!root && root.role === 'smm' && root.audience === 'client' && !root.parent_id, 'SMM root persisted (role=smm, audience=client, is a root)');

    // 2) client replies into that thread (reply inherits the root's client audience)
    await Q.waitForPost(cli, PID, "p=>(_calCommentsForView(p,'caption')||[]).some(c=>/SMM-ROOT/.test(c.body||''))");
    await postComment(cli, PID, root.id, CREPLY, 'caption', 'client');
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(CREPLY), 'caption_tweaks');

    // 3) SMM replies again — the client's reply must still be there (no clobber)
    await Q.waitForPost(smm, PID, "p=>(_calCommentsForView(p,'caption')||[]).some(c=>/CLIENT-REPLY/.test(c.body||''))");
    await postComment(smm, PID, root.id, SREPLY, 'caption', 'client');
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(SREPLY), 'caption_tweaks');

    // 4) SMM drops an INTERNAL note (own thread, not client-visible)
    await postComment(smm, PID, null, SINT, 'caption', 'internal');

    const finalList = await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(SINT) && (r.caption_tweaks || '').includes(SREPLY), 'caption_tweaks', 16000);
    let fl = []; try { fl = JSON.parse(finalList.caption_tweaks || '[]'); } catch (e) {}
    const live = fl.filter(c => !c.deleted);
    const byBody = b => live.find(c => (c.body || '') === b);
    S.ok(live.length >= 4, 'all four messages unioned in the backend (got ' + live.length + ')');
    S.ok(byBody(CREPLY) && byBody(CREPLY).role === 'client' && byBody(CREPLY).parent_id === root.id, 'client reply present, role=client, parented to the SMM root (not clobbered)');
    S.ok(byBody(SREPLY) && byBody(SREPLY).role === 'smm' && byBody(SREPLY).parent_id === root.id, 'second SMM reply present in the thread');
    const si = byBody(SINT);
    S.ok(si && si.role === 'smm' && si.audience === 'internal' && !si.parent_id, 'SMM internal note present (role=smm, audience=internal, root)');

    // client surface: sees the client thread, NOT the internal note
    const cliBodies = await viewBodies(cli, PID);
    S.ok(cliBodies && cliBodies.includes(ROOT) && cliBodies.includes(CREPLY) && cliBodies.includes(SREPLY), 'client SEES the SMM root + both replies in the client thread');
    S.ok(cliBodies && !cliBodies.includes(SINT), 'client does NOT see the SMM internal note (privacy held under a live thread)');

    S.ok(smm._errs.length === 0 && cli._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...cli._errs].slice(0, 3)) + ')');
  } finally {
    try { const r = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {}
      const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: new Date().toISOString() }));
      await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
