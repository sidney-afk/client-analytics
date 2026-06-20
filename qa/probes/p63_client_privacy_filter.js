// p63 — client-surface privacy filter (_calCommentsForView). Two-layer guard the client link
// applies: (1) NEVER expose Kasper authorship, (2) only show threads whose ROOT is client-audience
// (replies inherit their root's audience). A leak here would be a serious privacy bug.
//   client SEES:   SMM client-audience root + SMM reply in that thread
//   client HIDDEN: Kasper reply (even inside a client thread), SMM internal root + its reply,
//                  Kasper internal root
//   SMM sees: everything
const Q = require('./lib.js');
const TS = Math.floor(Date.now() / 1000);
const PID = 'p_priv_' + TS;
const now = () => new Date().toISOString();
const mk = (id, role, audience, body, parent_id) => ({ id, parent_id: parent_id || null, author: role === 'client' ? 'Client' : (role === 'kasper' ? 'Kasper' : 'Synchro Social'), role, is_tweak: false, audience, body, created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });

const A1 = 'CLIENT-ROOT-' + TS, A2 = 'KASPER-REPLY-INCLIENT-' + TS, A3 = 'SMM-REPLY-INCLIENT-' + TS,
      B1 = 'INTERNAL-ROOT-' + TS, B2 = 'SMM-REPLY-ININTERNAL-' + TS, C1 = 'KASPER-ROOT-' + TS;

const viewBodies = (page, pid) => page.evaluate(async (a) => {
  for (let i = 0; i < 12; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 700)); const p = (calState.posts || []).find(x => x.id === a.pid); if (p && _calCommentsForView(p, 'caption').length) break; }
  const p = (calState.posts || []).find(x => x.id === a.pid); if (!p) return null;
  return (_calCommentsForView(p, 'caption') || []).map(c => c.body || '');
}, { pid });

(async () => {
  const S = Q.makeOk('P63 client privacy filter');
  const browser = await Q.launch();
  const cli = await Q.clientPage(browser);
  const smm = await Q.smmPage(browser);
  try {
    const thread = [
      mk('a1_' + TS, 'smm', 'client', A1),
      mk('a2_' + TS, 'kasper', 'internal', A2, 'a1_' + TS),   // Kasper reply inside a client thread
      mk('a3_' + TS, 'smm', 'client', A3, 'a1_' + TS),        // SMM reply inside the client thread
      mk('b1_' + TS, 'smm', 'internal', B1),
      mk('b2_' + TS, 'smm', 'internal', B2, 'b1_' + TS),
      mk('c1_' + TS, 'kasper', 'internal', C1),
    ];
    await Q.up({ id: PID, name: 'PRIV ' + TS, platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify(thread) });
    await Q.pollRaw(PID, r => (r.caption_tweaks || '').includes(A1), 'caption_tweaks');
    await Q.waitForPost(cli, PID, "p=>p.id==='" + PID + "'");
    await Q.waitForPost(smm, PID);

    const cliBodies = await viewBodies(cli, PID);
    const has = (arr, s) => arr.some(b => b.includes(s));
    S.ok(cliBodies && has(cliBodies, A1), 'client SEES the SMM client-audience root');
    S.ok(cliBodies && has(cliBodies, A3), 'client SEES the SMM reply inside the client thread');
    S.ok(cliBodies && !has(cliBodies, A2), 'client does NOT see the Kasper reply (even inside a client thread)');
    S.ok(cliBodies && !has(cliBodies, B1), 'client does NOT see the SMM internal root');
    S.ok(cliBodies && !has(cliBodies, B2), 'client does NOT see a reply in an internal thread');
    S.ok(cliBodies && !has(cliBodies, C1), 'client does NOT see the Kasper internal root');

    const smmBodies = await viewBodies(smm, PID);
    S.ok(smmBodies && [A1, A2, A3, B1, B2, C1].every(s => has(smmBodies, s)), 'SMM (team) sees ALL six messages');

    S.ok(cli._errs.length === 0 && smm._errs.length === 0, 'no JS errors (' + JSON.stringify([...cli._errs, ...smm._errs].slice(0, 3)) + ')');
  } finally {
    try { const r = await Q.rawRow(PID, 'caption_tweaks'); let a = []; try { a = JSON.parse(r.caption_tweaks || '[]'); } catch (e) {} const tomb = a.map(c => Object.assign({}, c, { deleted: true, updated_at: now() })); await Q.up({ id: PID, caption_tweaks: JSON.stringify(tomb), status: 'Archived' }); } catch (e) {}
    await browser.close();
  }
  process.exit(S.done());
})();
