'use strict';
// Clients Info parity after a native edit (2026-10-18). Native edits change a
// client_profiles row without recomputing its stored row_hash, so the daily
// parity (which used to compare that stored hash) stayed red after any Clients
// tab edit even when the Sheet copy matched. The parity now hashes the row's
// current values. Fully mocked; synthetic names only.
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const parity = require('../scripts/sheets-mirror-parity.js');

(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '..', 'supabase/functions/_shared/sheets-mirror.mjs')).href);
  const rn = await import(pathToFileURL(path.join(__dirname, '..', 'supabase/functions/_shared/roster-native.mjs')).href);
  let n = 0;
  const ok = (c, msg) => { assert.ok(c, msg); n++; };

  // The row as the database holds it after a native save: values changed, row_hash left at its old value.
  const stale = await m.rowHash('client_profiles', { client_name: 'Probe Client', email: 'old@example.invalid' });
  const dbRow = { slug: 'probeclient', display_name: 'Probe Client', email: null, competitors: null, keywords: 'a, b',
    specific_keywords: null, content_description: 'Line one\nLine two', instagram_handle: null, tiktok_handle: null,
    youtube_channel_id: null, slack_channel_id: 'C123', creative_channel_id: null, roam_channel_id: null,
    upload_post_profile: null, postforme_account_id: null, row_hash: stale, extra: { postforme_instagram_account_id: 'x' } };

  // What the Sheet copy writes for that row, read back the way the parity reads the tab (CSV text).
  const sheetObj = rn.profileToSheetObject(dbRow);
  const csv = [rn.CLIENT_HEADERS.join(','), rn.CLIENT_HEADERS.map(h => '"' + String(sheetObj[h]).replace(/"/g, '""') + '"').join(',')].join('\n');
  const sheetRow = m.parseCsv(csv)[0];
  const sheetHash = await m.rowHash('client_profiles', sheetRow);

  ok(sheetHash !== stale, 'the stored hash is stale after the native edit (the old behaviour would report a difference)');
  ok(await parity.profileHash(m, dbRow) === sheetHash, 'null versus empty, multi-line text and the extra column read back to the same fingerprint');

  // End to end through dbGroupsRest with a mocked read: no difference when the Sheet copy matches.
  const realFetch = global.fetch, env = { ...process.env };
  process.env.SUPABASE_URL = 'https://example.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic';
  const urls = [];
  global.fetch = async url => { urls.push(String(url)); return { ok: true, json: async () => [dbRow] }; };
  let dbGroups;
  try { dbGroups = await parity.dbGroupsRest('client_profiles', '2026-07-01'); }
  finally {
    global.fetch = realFetch;
    for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  }
  ok(/select=slug,display_name,email/.test(urls[0]) && !/row_hash/.test(urls[0]), 'the read asks for the values, not the stored hash');
  const sheetGroups = new Map();
  parity.addTo(sheetGroups, m.clientSlug(sheetRow.client_name), '', sheetHash);
  const res = parity.compareGroups(sheetGroups, dbGroups);
  ok(res.differences.length === 0 && res.matched === 1, 'a native edit followed by a matching Sheet copy reports no difference');

  // A real difference is still caught.
  const other = new Map();
  parity.addTo(other, 'probeclient', '', await m.rowHash('client_profiles', { ...sheetRow, email: 'new@example.invalid' }));
  ok(parity.compareGroups(other, dbGroups).differences[0].kind === 'values_differ', 'a Sheet value that really differs is still reported');

  // ---- Both directions, column by column ----
  // Every column the Sheet copy writes is part of the fingerprint: a change on either side is reported.
  const cols = m.DATASETS.client_profiles.columns.filter(c => c !== 'client_name');
  const sheetOf = row => { const o = rn.profileToSheetObject(row); return m.parseCsv([rn.CLIENT_HEADERS.join(','), rn.CLIENT_HEADERS.map(h => '"' + String(o[h]).replace(/"/g, '""') + '"').join(',')].join('\n'))[0]; };
  const same = await m.rowHash('client_profiles', sheetOf(dbRow));
  for (const c of cols.concat(['display_name'])) {
    const changed = { ...dbRow, [c]: 'changed value' };
    ok(await parity.profileHash(m, changed) !== same, 'a database-side change of ' + c + ' is reported (Sheet unchanged)');
    const sheetSide = sheetOf(changed);
    ok(await m.rowHash('client_profiles', sheetSide) !== await parity.profileHash(m, dbRow), 'a Sheet-side change of ' + c + ' is reported (database unchanged)');
  }
  // What the Sheet copy treats as the same text never differs: empty versus missing, padding, line endings.
  ok(await parity.profileHash(m, { ...dbRow, email: '' }) === await parity.profileHash(m, { ...dbRow, email: null }), 'empty and null agree');
  ok(await parity.profileHash(m, { ...dbRow, keywords: '  a, b  ' }) === await parity.profileHash(m, dbRow), 'padding does not matter');
  // A Sheet cell still holding "\r\n" beside a database value stored with "\n": the copy treats them as the
  // same text and never rewrites the cell, so the parity must not report it (read through the real Sheet reader).
  const crlfSheet = 'client_name,keywords,content_description\n"Probe Client","a, b","Line one\r\nLine two"';
  const crlfGroups = await parity.sheetGroups(m, 'client_profiles', crlfSheet, '');
  const crlfDb = { slug: 'probeclient', display_name: 'Probe Client', keywords: 'a, b', content_description: 'Line one\nLine two' };
  ok(crlfGroups.get('probeclient\u0000').hashes[0] === await parity.profileHash(m, crlfDb), 'line endings the copy ignores are not a difference');
  // The extra column (not part of the fingerprint) and bookkeeping never change it.
  ok(await parity.profileHash(m, { ...dbRow, extra: { postforme_instagram_account_id: 'other' }, row_hash: 'zzz', updated_by: 'x' }) === await parity.profileHash(m, dbRow), 'extra and bookkeeping are not fingerprinted');

  // ---- The real script, end to end, against mocked reads ----
  // A native edit whose Sheet copy landed: no difference. A real difference on either side: reported,
  // and nothing printed carries a value, a name or a slug.
  const { spawnSync } = require('child_process');
  const fs = require('fs'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-'));
  const run = (sheetRow, dbOverride) => {
    const sheetCsv = rn.CLIENT_HEADERS.join(',') + '\n' + rn.CLIENT_HEADERS.map(h => '"' + String(sheetRow[h]).replace(/"/g, '""') + '"').join(',');
    const file = path.join(dir, 'scenario.json'), jsonOut = path.join(dir, 'report.json');
    fs.writeFileSync(file, JSON.stringify({ sheets: { 'Clients Info': sheetCsv }, tables: { client_profiles: [{ ...dbRow, ...dbOverride }] } }));
    const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'helpers', 'parity-fetch-mock.js'), path.join(__dirname, '..', 'scripts', 'sheets-mirror-parity.js'), '--strict', '--json=' + jsonOut],
      { env: { ...process.env, PARITY_MOCK: file, SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' }, encoding: 'utf8' });
    return { status: r.status, out: r.stdout + r.stderr + (fs.existsSync(jsonOut) ? fs.readFileSync(jsonOut, 'utf8') : '') };
  };
  const secret = 'SECRET-VALUE-9f3a';
  const landed = run(sheetObj, {});
  ok(landed.status === 0 && /PARITY: clean/.test(landed.out) && /client_profiles\s+groups\s+1\s+matched\s+1\s+differing\s+0/.test(landed.out), 'script: a native edit with its Sheet copy landed reports clean');
  const sheetDiffers = run({ ...sheetObj, email: secret }, {});
  ok(sheetDiffers.status === 1 && /PARITY: 1 difference/.test(sheetDiffers.out), 'script: a Sheet value that differs is reported (exit 1)');
  const dbDiffers = run(sheetObj, { email: secret, display_name: 'Probe Client' });
  ok(dbDiffers.status === 1 && /PARITY: 1 difference/.test(dbDiffers.out), 'script: a database value that differs is reported (exit 1)');
  for (const r of [landed, sheetDiffers, dbDiffers]) {
    ok(!r.out.includes(secret) && !/probe\s*client/i.test(r.out) && !r.out.includes('probeclient') && !r.out.includes('C123') && !r.out.includes('Line one'), 'script output carries no value, name or slug');
  }
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`sheets-mirror-profile-parity: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
