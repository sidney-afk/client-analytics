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

  const values = catchup.toSheetValues(['date', 'client_name', 'ig_followers', 'custom_col'], { date: '2026-09-02', client_name: 'Probe One', ig_followers: '2', extra: { custom_col: 'x' } });
  ok(JSON.stringify(values) === JSON.stringify(['2026-09-02', 'Probe One', '2', 'x']), 'rows go back in the tab column order, extra columns to their own column');
  ok(catchup.csvLine(['a"b', '']) === '"a""b",""', 'CSV output quotes every value');

  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts/sheets-mirror-catchup.js'), 'utf8');
  ok(/--apply on the live Sheet needs --production/.test(src), 'the catch-up refuses to write the live Sheet without --production');
  ok(!/console\.log\([^)]*client_name/.test(src) && !/console\.log\([^)]*client_name/.test(fs.readFileSync(path.join(__dirname, '..', 'scripts/sheets-mirror-parity.js'), 'utf8')),
    'neither script prints client names');

  console.log(`sheets-mirror-parity-catchup: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
