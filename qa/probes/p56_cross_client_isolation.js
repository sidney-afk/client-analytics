// p56 — cross-client ISOLATION + Kasper bulk-read grouping correctness (read-only; mutates ONLY
// Sidney). After the pagination change, the Kasper bulk read groups the whole table by client.
//   • the per-client calendar read (SMM, Sidney) returns ONLY sidneylaruel rows (no foreign leak)
//   • the paginated full-table read groups a seeded Sidney card under sidneylaruel and NO other
//     client's bucket
//   • the Kasper queue attributes the seeded card to client "Sidney Laruel" / slug sidneylaruel
//   • NO foreign client's card appears in Sidney's SMM calendar
const Q = require('./lib.js');
const PID = 'p_iso_' + Math.floor(Date.now() / 1000);

(async () => {
  const S = Q.makeOk('P56 cross-client isolation + grouping');
  const browser = await Q.launch();
  const smm = await Q.smmPage(browser);
  const kas = await Q.kasperPage(browser);
  try {
    await Q.up({ id: PID, name: 'ISO ' + PID.slice(-6), platforms: 'instagram', scheduled_date: '2026-06-29',
      video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Kasper Approval', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4' });
    await Q.pollRaw(PID, r => r.caption_status === 'Kasper Approval', 'caption_status');

    // 1) per-client SMM read returns ONLY sidneylaruel rows (app way, inside the page)
    const perClient = await smm.evaluate(async (pid) => {
      const rows = await _calSupabaseFetchAllRows(CAL_SUPABASE_URL + '/rest/v1/calendar_posts?select=id,client&client=eq.sidneylaruel', undefined);
      const clients = [...new Set(rows.map(r => String(r.client || '')))];
      return { count: rows.length, clients, hasMine: rows.some(r => r.id === pid) };
    }, PID);
    S.ok(perClient.clients.length === 1 && perClient.clients[0] === 'sidneylaruel', 'per-client read returns ONLY sidneylaruel rows (clients=' + JSON.stringify(perClient.clients) + ')');
    S.ok(perClient.hasMine === true, 'per-client read contains the seeded Sidney card');

    // 2) full-table paginated read groups the seeded card under sidneylaruel and NO other bucket
    const grouping = await kas.evaluate(async (pid) => {
      const rows = await _calSupabaseFetchAllRows(CAL_SUPABASE_URL + '/rest/v1/calendar_posts?select=id,client', undefined);
      const buckets = rows.filter(r => r.id === pid).map(r => String(r.client || ''));
      const byClient = new Map();
      for (const r of rows) { const c = String(r.client || ''); if (!c) continue; if (!byClient.has(c)) byClient.set(c, []); byClient.get(c).push(r.id); }
      const inSidney = (byClient.get('sidneylaruel') || []).includes(pid);
      const otherBuckets = [...byClient.entries()].filter(([c, ids]) => c !== 'sidneylaruel' && ids.includes(pid)).map(([c]) => c);
      return { bucketsForCard: buckets, inSidney, otherBuckets, totalClients: byClient.size };
    }, PID);
    S.ok(grouping.inSidney === true, 'paginated full-table read buckets the card under sidneylaruel');
    S.ok(grouping.otherBuckets.length === 0, 'card appears in NO other client bucket (got ' + JSON.stringify(grouping.otherBuckets) + ')');
    S.ok(grouping.totalClients > 1, 'full-table read spans many clients (' + grouping.totalClients + ') — isolation is real, not an empty table');

    // 3) Kasper queue attributes the card to Sidney
    S.ok(await Q.kasperLoadHas(kas, PID), 'seeded card in Kasper queue');
    const attrib = await kas.evaluate((pid) => { const it = (_kasperState.items || []).find(x => x.post.id === pid); return it ? { client: it.client, slug: it.slug } : null; }, PID);
    S.ok(attrib && attrib.slug === 'sidneylaruel', 'Kasper attributes the card to slug sidneylaruel (got ' + JSON.stringify(attrib) + ')');

    // 4) NO foreign client's card appears in Sidney's SMM calendar (calState is all-Sidney)
    const foreign = await smm.evaluate(async (pid) => {
      for (let i = 0; i < 10; i++) { try { await loadCalendarPosts(); } catch (e) {} await new Promise(x => setTimeout(x, 600)); }
      // cross-check each loaded post id against the Supabase client column
      const ids = (calState.posts || []).map(p => p.id).filter(Boolean);
      if (!ids.length) return { checked: 0, foreign: [] };
      const inList = ids.map(id => '"' + id + '"').join(',');
      const rows = await _calSupabaseFetchAllRows(CAL_SUPABASE_URL + '/rest/v1/calendar_posts?select=id,client&id=in.(' + ids.map(encodeURIComponent).join(',') + ')', undefined);
      const map = new Map(rows.map(r => [r.id, String(r.client || '')]));
      const foreign = ids.filter(id => map.has(id) && map.get(id) !== 'sidneylaruel');
      return { checked: ids.length, foreign: foreign.slice(0, 5) };
    }, PID);
    S.ok(foreign.checked > 0, 'SMM calendar loaded Sidney posts to check (' + foreign.checked + ')');
    S.ok(foreign.foreign.length === 0, 'NO foreign-client card leaked into Sidney calendar (foreign=' + JSON.stringify(foreign.foreign) + ')');

    S.ok(smm._errs.length === 0 && kas._errs.length === 0, 'no JS errors (' + JSON.stringify([...smm._errs, ...kas._errs].slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
