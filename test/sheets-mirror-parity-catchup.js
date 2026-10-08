'use strict';
/*
 * sheets-mirror-parity-catchup.js — the daily comparison and the catch-up job
 * (scripts/sheets-mirror-parity.js, scripts/sheets-mirror-catchup.js), offline.
 *
 * The comparison must name every per-client-per-day group that differs and
 * say how; the catch-up must add exactly the rows the Sheet lacks, in the
 * tab's column order, and add nothing on a second run. Synthetic rows only.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const parity = require('../scripts/sheets-mirror-parity.js');
const catchup = require('../scripts/sheets-mirror-catchup.js');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  ok  ' + msg); };

(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '..', 'supabase/functions/_shared/sheets-mirror.mjs')).href);
  const row = (name, date, ig) => ({ date, client_name: name, ig_followers: String(ig) });

  // ---- comparison ----
  const sheet = new Map(), db = new Map();
  const put = async (g, r) => parity.addTo(g, m.clientSlug(r.client_name), r.date, await m.rowHash('metrics', r));
  for (const r of [row('Probe One', '2026-09-01', 1), row('Probe One', '2026-09-02', 2), row('Probe Two', '2026-09-01', 5), row('Probe Two', '2026-09-01', 5)]) await put(sheet, r);
  for (const r of [row('Probe One', '2026-09-01', 1), row('Probe Two', '2026-09-01', 5), row('Probe Two', '2026-09-01', 5)]) await put(db, r);
  let res = parity.compareGroups(sheet, db);
  ok(res.matched === 2 && res.differences.length === 1 && res.differences[0].kind === 'missing_in_db', 'a day the mirror lacks is reported as missing_in_db');
  ok(res.differences[0].client === parity.ref('probeone') && !JSON.stringify(res).includes('probeone'), 'a client is named only by its sha256 reference');

  await put(db, row('Probe One', '2026-09-02', 3));
  res = parity.compareGroups(sheet, db);
  ok(res.differences[0].kind === 'values_differ' && res.differences[0].only_in_sheet === 1 && res.differences[0].only_in_db === 1, 'same count, different values: values_differ, one row each side');

  const dup = new Map(); for (const r of [row('Probe Two', '2026-09-01', 5)]) await put(dup, r);
  const sheetTwo = new Map([...sheet].filter(([k]) => k.startsWith('probetwo')));
  res = parity.compareGroups(sheetTwo, dup);
  ok(res.differences[0].kind === 'count_differs' && res.differences[0].sheet_rows === 2 && res.differences[0].db_rows === 1, 'an exact duplicate row the mirror holds once is a count difference');

  const digests = new Map([...sheet].map(([k, g]) => [k, { slug: g.slug, day: g.day, count: g.hashes.length, digest: parity.digest(g.hashes) }]));
  ok(parity.compareGroups(sheet, digests).differences.length === 0, 'digests computed elsewhere (read-only SQL) compare equal to the same rows');

  // ---- catch-up ----
  const sheetRows = [row('Probe One', '2026-09-01', 1), row('Probe Two', '2026-09-01', 5)];
  const dbRows = [row('Probe One', '2026-09-01', 1), row('Probe Two', '2026-09-01', 5), row('Probe Two', '2026-09-01', 5), row('Probe One', '2026-09-02', 2)];
  const add = await catchup.missingRows(m, 'metrics', sheetRows, dbRows);
  ok(add.length === 2 && add.some(r => r.date === '2026-09-02') && add.filter(r => r.client_name === 'Probe Two').length === 1,
    'the catch-up adds the missing day and the second copy of a duplicate, nothing else');
  const again = await catchup.missingRows(m, 'metrics', sheetRows.concat(add), dbRows);
  ok(again.length === 0, 'a second run adds nothing');

  const brief = (id, name, raw) => ({ id, client_name: name, date: '2026-09-01', raw_json: raw });
  const bAdd = await catchup.missingRows(m, 'market_research_briefs', [brief('b1', 'Probe One', 'old')],
    [brief('b1', 'Probe One', 'new'), brief('b2', 'Probe Two', 'x')]);
  ok(bAdd.length === 1 && bAdd[0].id === 'b2' && bAdd.changed.length === 1 && bAdd.changed[0].id === 'b1',
    'a brief is keyed by id: a new id is appended, an edited one is reported for an in-place update, never appended twice');

  const values = catchup.toSheetValues(['date', 'client_name', 'ig_followers', 'custom_col'], { date: '2026-09-02', client_name: 'Probe One', ig_followers: '2', extra: { custom_col: 'x' } });
  ok(JSON.stringify(values) === JSON.stringify(['2026-09-02', 'Probe One', '2', 'x']), 'rows go back in the tab column order, extra columns to their own column');
  ok(catchup.csvLine(['a"b', '']) === '"a""b",""', 'CSV output quotes every value');

  const bothSrc = fs.readFileSync(path.join(__dirname, '..', 'scripts/sheets-mirror-catchup.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'scripts/sheets-mirror-parity.js'), 'utf8');
  ok(/market_research_briefs: \{[^}]*order: 'id'/.test(bothSrc) && (bothSrc.match(/market_research_briefs: \{[^}]*order: 'id'/g) || []).length === 2,
    'briefs are paged by id in both scripts: that table has no seq column');
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts/sheets-mirror-catchup.js'), 'utf8');
  ok(/--apply on the live Sheet needs --production/.test(src), 'the catch-up refuses to write the live Sheet without --production');
  ok(!/console\.log\([^)]*client_name/.test(src) && !/console\.log\([^)]*client_name/.test(fs.readFileSync(path.join(__dirname, '..', 'scripts/sheets-mirror-parity.js'), 'utf8')),
    'neither script prints client names');

  // ---- after the switch (plan section 8b): the job's own rows are not compared, a live job's tab is not copied ----
  ok(parity.GROUPING.metrics.excludeSource === 'edge' && parity.GROUPING.top_videos.excludeSource === 'edge',
    'metrics and top_videos leave out the rows the daily jobs write themselves (source edge)');
  ok(!parity.GROUPING.content_summaries.excludeSource && !parity.GROUPING.market_research_briefs.excludeSource, 'the other datasets compare every row as before');
  const owned = parity.databaseOwnedDatasets([
    { key: 'analytics_metrics_collect', value: { mode: 'live' } },
    { key: 'analytics_top_videos_collect', value: { mode: 'shadow' } },
    { key: 'something_else', value: { mode: 'live' } }]);
  ok(owned.size === 1 && owned.has('metrics'), 'only a job whose switch is exactly "live" owns its dataset');
  ok(parity.databaseOwnedDatasets([{ key: 'analytics_top_videos_collect', value: { mode: 'Live' } }]).size === 0, 'anything but "live" owns nothing');
  {
    const prof = parity.databaseOwnedDatasets([{ key: 'client_profiles_authority', value: { source: 'syncview' } }]);
    ok(prof.size === 1 && prof.has('client_profiles'), 'Clients Info is left out of the copy once the database is its main copy');
    ok(parity.databaseOwnedDatasets([{ key: 'client_profiles_authority', value: { source: 'sheet' } }]).size === 0, 'while the Sheet is the main copy, Clients Info is still copied');
    ok(parity.databaseOwnedDatasets([{ key: 'client_profiles_authority', value: null }]).size === 0, 'a missing or malformed authority value owns nothing');
  }
  {
    const urls = [];
    const realFetch = global.fetch, env = { ...process.env };
    process.env.SUPABASE_URL = 'https://example.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic';
    global.fetch = async url => { urls.push(String(url)); return { ok: true, json: async () => [] }; };
    await parity.dbGroupsRest('metrics', '2026-07-01');
    await parity.dbGroupsRest('top_videos', '2026-07-01');
    await parity.dbGroupsRest('content_summaries', '2026-07-01');
    const flagsSeen = [];
    await parity.readDatabaseOwned(process.env, async url => { flagsSeen.push(String(url)); return { ok: true, json: async () => [{ key: 'analytics_top_videos_collect', value: { mode: 'live' } }] }; })
      .then(s => flagsSeen.push([...s].join(',')));
    let refused = false;
    await parity.readDatabaseOwned(process.env, async () => ({ ok: false, status: 503 })).catch(() => { refused = true; });
    global.fetch = realFetch; process.env.SUPABASE_URL = env.SUPABASE_URL; process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
    if (env.SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
    if (env.SUPABASE_SERVICE_ROLE_KEY === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    ok(flagsSeen[0].includes('client_profiles_authority'), 'the switch read also asks for the Clients Info authority');
    ok(urls[0].includes('/analytics_metrics?') && urls[0].includes('&source=neq.edge'), 'the metrics read asks the database to leave out source edge');
    ok(urls[1].includes('/analytics_top_videos?') && urls[1].includes('scraped_date=gte.2026-07-01&source=neq.edge'), 'so does the top videos read, inside its 90 days');
    ok(!urls[2].includes('source='), 'the content summaries read is unchanged');
    ok(flagsSeen[0].includes('key=in.(analytics_metrics_collect,analytics_top_videos_collect,client_profiles_authority)') && flagsSeen[1] === 'top_videos', 'the two switches and the Clients Info authority are read and a live one is owned');
    ok(refused, 'a failed switch read is an error, never "nothing owned"');
  }
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github/workflows/sheets-mirror-daily.yml'), 'utf8');
  ok((wf.match(/sheets-mirror-backfill\.js[^;\n]*--skip-database-owned/g) || []).length === 2, 'the daily lane copies with --skip-database-owned, in both its apply and dry-run forms');

  console.log(`sheets-mirror-parity-catchup: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
