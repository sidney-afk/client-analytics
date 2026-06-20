// p46 — verifies the Supabase pagination fix. Before the fix, the app's single
// `?select=*&limit=20000` read was capped at PostgREST max-rows (1000), so with
// 1000+ rows in the table a freshly-added card sorting past the window vanished
// from Kasper's UNSCOPED queue (the p45 repro). After the fix:
//   (A) _calSupabaseFetchAllRows returns ALL rows (> the 1000 cap), and
//   (B) a fresh video@Kasper-Approval card now surfaces in Kasper's queue.
const Q = require('./lib.js');
const PID = 'p_pg_' + Math.floor(Date.now() / 1000);

(async () => {
  const S = Q.makeOk('P46 supabase pagination fix');
  const browser = await Q.launch();
  const kas = await Q.kasperPage(browser);
  try {
    // total rows in the table right now (capped read would return only 1000)
    const total = await kas.evaluate(async () => {
      const r = await fetch(CAL_SUPABASE_URL + '/rest/v1/calendar_posts?select=id', { headers: { apikey: CAL_SUPABASE_ANON_KEY, Authorization: 'Bearer ' + CAL_SUPABASE_ANON_KEY, Prefer: 'count=exact', Range: '0-0' } });
      const cr = r.headers.get('content-range') || ''; return Number((cr.split('/')[1]) || 0);
    });
    console.log('table total rows:', total);

    // (A) the paginator returns EVERY row in the table (vs the old 1000 cap).
    // NOTE: `id` is NOT globally unique — the same id is reused across different
    // clients (rows key on (client, id)), so uniq(id) < len is EXPECTED, not a
    // pagination defect. The completeness property is len === total (no row
    // skipped). The COMPOUND (id, client) keyset is what guarantees a same-id
    // group straddling a page boundary is never skipped (proven separately at
    // small page sizes against the live table).
    const paged = await kas.evaluate(async () => {
      const rows = await _calSupabaseFetchAllRows(CAL_SUPABASE_URL + '/rest/v1/calendar_posts?select=id,client', undefined);
      const ids = new Set(rows.map(r => r.id));
      return { len: rows.length, uniq: ids.size };
    });
    console.log('paginated fetch:', JSON.stringify(paged), '(uniq<len is DB-side dup ids, not a pagination bug)');
    // allow ±a few rows for live writes between the count and the scan
    S.ok(Math.abs(paged.len - total) <= 3, 'paginator returns ALL ~' + total + ' rows (got ' + paged.len + ', not capped at 1000)');
    S.ok(paged.len > 1000, 'fetched MORE than the 1000-row PostgREST cap (proves pagination works)');
    S.ok(paged.uniq > 1000, 'fetched MORE than 1000 DISTINCT ids past the cap (' + paged.uniq + ' distinct)');

    // (B) a fresh card that sorts past the cap now surfaces in Kasper's queue
    await Q.up({ id: PID, name: 'PG ' + PID.slice(-6), platforms: 'youtube', scheduled_date: '2026-06-29',
      video_status: 'Kasper Approval', graphic_status: 'Approved', caption_status: 'Approved', status: 'Kasper Approval',
      thumbnail_url: 'https://via.placeholder.com/320x180.png', asset_url: 'https://example.com/g.mp4',
      video_tweaks: '[]', kasper_approved_after_tweaks: '' });
    await Q.pollRaw(PID, r => r.video_status === 'Kasper Approval', 'video_status');
    const inQueue = await kas.evaluate(async (pid) => {
      for (let i = 0; i < 22; i++) { try { await _kasperLoadReview(true); } catch (e) {} await new Promise(x => setTimeout(x, 900)); if ((_kasperState.items || []).some(x => x.post.id === pid)) return true; }
      return (_kasperState.items || []).some(x => x.post.id === pid);
    }, PID);
    S.ok(inQueue, 'fresh video@Kasper-Approval card NOW surfaces in Kasper queue (was hidden by the 1000 cap)');

    // and the paginated read includes the fresh card too
    const hasFresh = await kas.evaluate(async (pid) => {
      const rows = await _calSupabaseFetchAllRows(CAL_SUPABASE_URL + '/rest/v1/calendar_posts?select=id,client', undefined);
      return rows.some(r => r.id === pid);
    }, PID);
    S.ok(hasFresh, 'paginated read contains the fresh card id');

    S.ok(kas._errs.length === 0, 'no JS errors (' + JSON.stringify(kas._errs.slice(0, 3)) + ')');
  } finally { try { await Q.archive(PID); } catch (e) {} await browser.close(); }
  process.exit(S.done());
})();
