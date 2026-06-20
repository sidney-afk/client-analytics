// p50 — one card, three components in DIFFERENT states at once. Each surface must show only
// the components in ITS purview (the per-component review model), and overall = lowest-priority.
//   video = Kasper Approval        → Kasper-actionable, NOT client
//   graphic = Client Approval      → client-actionable, NOT Kasper
//   caption = Tweaks Needed (open Kasper tweak) → Kasper-actionable (re-review), NOT client
//   overall = Tweaks Needed (lowest priority across the three)
const Q = require('./lib.js');
const PID = 'p_mix_' + Math.floor(Date.now() / 1000);
const now = () => new Date().toISOString();
const kasperTweak = (id) => ({ id, parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: true, round: 1, audience: 'internal', body: 'Kasper: tighten the caption', created_at: now(), updated_at: now(), done: false, done_at: '', done_by: '' });

const kComp = (kas, pid, comp) => kas.evaluate((a) => { const it = (_kasperState.items || []).find(x => x.post.id === a.pid); return it ? !!_calCompKasperVisible(it.post, a.comp) : '__noitem__'; }, { pid, comp });

(async () => {
  const S = Q.makeOk('P50 mixed-state card per-surface visibility');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  const cli = await Q.clientPage(browser);
  const smm = await Q.smmPage(browser);
  try {
    await Q.up({ id: PID, name: 'MIX ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Client Approval', caption_status: 'Tweaks Needed', status: 'Tweaks Needed',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      caption_tweaks: JSON.stringify([kasperTweak('kt_' + PID.slice(-6))]) });
    await Q.pollRaw(PID, r => r.video_status === 'Kasper Approval' && r.graphic_status === 'Client Approval' && r.caption_status === 'Tweaks Needed', 'video_status,graphic_status,caption_status');

    // overall is the lowest-priority sub-status = Tweaks Needed
    const r0 = await Q.rawRow(PID, 'status'); S.ok(r0.status === 'Tweaks Needed', 'overall = Tweaks Needed (lowest priority across mixed subs)');

    // KASPER: video (KA) + caption (TN+open kasper tweak) actionable; graphic (CA) NOT
    S.ok(await Q.kasperLoadHas(kas, PID), 'card in Kasper queue (mixed state)');
    S.ok((await kComp(kas, PID, 'video')) === true, 'Kasper: video (Kasper Approval) is actionable');
    S.ok((await kComp(kas, PID, 'caption')) === true, 'Kasper: caption (Tweaks Needed + open kasper tweak) is actionable (re-review)');
    S.ok((await kComp(kas, PID, 'graphic')) === false, 'Kasper: graphic (Client Approval) is NOT in his purview');

    // CLIENT: graphic (CA) active; video (KA) and caption (TN) NOT active for her
    await Q.waitForPost(cli, PID, "p=>p.id==='" + PID + "'");
    S.ok((await Q.clientCompActive(cli, PID, 'graphic')) === true, 'Client: graphic (Client Approval) is active (awaiting her)');
    S.ok((await Q.clientCompActive(cli, PID, 'video')) === false, 'Client: video (Kasper Approval) is NOT active for her (internal)');
    S.ok((await Q.clientCompActive(cli, PID, 'caption')) === false, 'Client: caption (Tweaks Needed) is NOT active for her (being worked)');

    // SMM: sees the card with each sub-status intact (no surface collapses the mixed state)
    const smmState = await smm.evaluate(async (pid) => { for (let i = 0; i < 22; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 800)); const p = (calState.posts || []).find(x => x.id === pid); if (p) return { v: p.video_status, g: p.graphic_status, c: p.caption_status }; } return null; }, PID);
    S.ok(smmState && smmState.v === 'Kasper Approval' && smmState.g === 'Client Approval' && smmState.c === 'Tweaks Needed', 'SMM sees all three distinct sub-statuses intact (' + JSON.stringify(smmState) + ')');

    S.ok(kas._errs.length === 0 && cli._errs.length === 0 && smm._errs.length === 0, 'no JS errors (' + JSON.stringify([...kas._errs, ...cli._errs, ...smm._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
