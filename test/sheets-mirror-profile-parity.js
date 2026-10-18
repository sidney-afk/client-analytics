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

  console.log(`sheets-mirror-profile-parity: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
