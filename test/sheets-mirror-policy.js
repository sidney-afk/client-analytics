'use strict';
// Offline contract for the Sheets -> Supabase mirror (Phase 1): the shared
// row logic, and the safety rules of analytics-read / analytics-write read
// from their source. The database side is measured separately, per role, by
// test/sheets-mirror-roles-postgres.js.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { stripBlockComments } = require('./helpers/strip-comments');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const READ_SRC = read('supabase/functions/analytics-read/index.ts');
const WRITE_SRC = read('supabase/functions/analytics-write/index.ts');
const VERIFY_SRC = read('supabase/functions/client-token-verify/index.ts');
const CONFIG = read('supabase/config.toml');
const MIGRATION = read('migrations/2026-09-25-sheets-mirror-phase1.sql');
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; console.log('  ok  ' + msg); };

(async () => {
  const m = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/sheets-mirror.mjs')).href);

  // ---- client slug: identical to the rule the link check already uses ----
  const verifyBody = VERIFY_SRC.match(/function normalizeClient\(s: unknown\): string \{([\s\S]*?)\n\}/)[1];
  const mirrorBody = read('supabase/functions/_shared/sheets-mirror.mjs').match(/export function clientSlug\(name\) \{([\s\S]*?)\n\}/)[1];
  const steps = s => stripBlockComments(s).replace(/"/g, "'").match(/\.replace\([^;]+\)/g);
  ok(JSON.stringify(steps(verifyBody)) === JSON.stringify(steps(mirrorBody)),
    'clientSlug applies exactly the normalization client-token-verify applies');
  ok(m.clientSlug('  Dr. Ána  and Bo ') === 'ana&bo', 'clientSlug strips accents, a "Dr." prefix and joins "and"');

  // ---- dates and the 90-day window ----
  ok(m.isIsoDate('2026-02-28') && !m.isIsoDate('2026-02-30') && !m.isIsoDate('28/02/2026'), 'only real ISO dates pass');
  ok(m.topVideosCutoff(new Date('2026-09-25T23:00:00Z')) === '2026-06-27', 'TopVideos window is the last 90 days');

  // ---- row identity ----
  const a = { date: '2026-09-01', client_name: 'Probe Client', ig_followers: '10' };
  const h1 = await m.rowHash('metrics', a);
  ok(/^[0-9a-f]{64}$/.test(h1), 'row_hash is a sha256 hex string (the column check accepts it)');
  ok(h1 === await m.rowHash('metrics', { ...a, ig_followers: ' 10 ', zzz: 'ignored' }),
    'the fingerprint ignores surrounding spaces and unknown columns');
  ok(h1 !== await m.rowHash('metrics', { ...a, ig_followers: '11' }), 'a changed value is a different row');
  ok(h1 !== await m.rowHash('top_videos', a), 'the same values in another dataset are a different row');

  const { records, rejected } = await m.prepareRows('metrics',
    [a, a, { ...a, ig_followers: '11' }, { ...a, date: 'yesterday' }, { ...a, client_name: '' }, { ...a, new_col: 'x' }],
    { source: 'n8n', runId: 'r1' });
  ok(records.map(r => r.row_occurrence).join(',') === '1,2,1,3', 'identical rows in one call get occurrences 1, 2, 3');
  ok(rejected.map(r => r.reason).join(',') === 'bad_date,missing_client', 'bad dates and missing clients are rejected, not stored');
  ok(records[3].extra.new_col === 'x', 'an unknown Sheet column is kept in extra, not dropped');
  ok(records[0].client_slug === 'probeclient' && records[0].source === 'n8n' && records[0].run_id === 'r1',
    'records carry slug, source and run id');

  const withOcc = await m.prepareRows('metrics', [{ ...a, _occurrence: 7 }], { source: 'n8n', runId: 'r' });
  ok(withOcc.records[0].row_occurrence === 1, 'only the backfill may supply its own occurrence');
  const backfill = await m.prepareRows('metrics', [{ ...a, _occurrence: 7 }], { source: 'sheet-backfill', runId: 'r' });
  ok(backfill.records[0].row_occurrence === 7 && !('_occurrence' in backfill.records[0].extra),
    'the backfill keeps sheet-wide occurrences so exact duplicate rows survive being split across calls');
  // n8n: occurrence continues across calls (Codex P1 on #1623).
  const prior = new Map([[h1, 1]]);
  const later = await m.prepareRows('metrics', [a, a], { source: 'n8n', runId: 'r2', runPart: 3, priorCounts: prior });
  ok(later.records.map(r => r.row_occurrence).join(',') === '2,3' && later.records[0].run_part === 3,
    'a real repeat in a later n8n call continues after the copies already stored, so it is kept, not dropped');
  const WRITE = read('supabase/functions/analytics-write/index.ts');
  ok(/if \(r\.run_id === runId && r\.run_part === runPart\) continue;/.test(WRITE),
    'a retry of the same call does not count its own rows, so it lands on the same keys');
  ok(/source !== "sheet-backfill"\s*\n?\s*\? await priorCounts\(/.test(WRITE),
    'the writer counts earlier copies for every source except the backfill, which brings sheet-wide occurrences');
  const annotated = await m.annotateSheetOccurrences('metrics', [a, { ...a, ig_followers: '11' }, a]);
  ok(annotated.map(r => r._occurrence).join(',') === '1,1,2', 'sheet-wide occurrences count identical rows only');

  const briefs = await m.prepareRows('market_research_briefs',
    [{ id: 'b1', client_name: 'Probe Client', raw_json: '{}' }, { client_name: 'Probe Client' }], { source: 'n8n', runId: 'r' });
  ok(briefs.records.length === 1 && briefs.records[0].id === 'b1' && briefs.rejected[0].reason === 'missing_id',
    'briefs are keyed by their id and a brief without one is rejected');
  const prof = await m.prepareRows('client_profiles', [{ client_name: 'Probe Client', email: 'x@example.invalid', instagram_handle: 'p' }],
    { source: 'sheet-copy', runId: 'r' });
  ok(prof.records[0].slug === 'probeclient' && prof.records[0].display_name === 'Probe Client' && !('source' in prof.records[0]),
    'a profile row maps client_name to slug + display_name, and the writer (not the caller) sets its source');
  ok(JSON.stringify(Object.keys(m.profileForClientLink({ slug: 's', display_name: 'd', email: 'e', slack_channel_id: 'c' })).sort())
    === JSON.stringify(['display_name', 'instagram_handle', 'slug', 'tiktok_handle', 'youtube_channel_id']),
    'a client link sees only its name and public handles, never email or channel ids');

  // ---- CSV ----
  const csv = m.parseCsv('"a","b",""\r\n"1","say ""hi""\nthere",""\n\n2,3,\n');
  ok(csv.length === 2 && csv[0].b === 'say "hi"\nthere' && !('' in csv[0]) && csv[1].a === '2',
    'the CSV parser handles doubled quotes, newlines in fields, blank lines and empty headers');

  // ---- migration column lists match the shared spec ----
  for (const [name, spec] of Object.entries(m.DATASETS)) {
    const table = MIGRATION.match(new RegExp('create table if not exists public\\.' + spec.table + ' \\(([\\s\\S]*?)\\n\\);'))[1];
    for (const c of spec.columns) {
      const col = c === 'client_name' && name === 'client_profiles' ? 'display_name' : c;
      assert.ok(new RegExp('\\n\\s+' + col + '\\s').test(table), `${spec.table} has column ${col}`);
    }
    checks++;
  }
  console.log('  ok  every Sheet column has a table column');

  // ---- analytics-write safety ----
  const serve = WRITE_SRC.slice(WRITE_SRC.indexOf('Deno.serve'));
  ok(/\[functions\.analytics-write\]\s*verify_jwt = false/.test(CONFIG), 'analytics-write has an explicit transport posture in config.toml');
  ok(serve.indexOf('requireWriteKey(req)') < serve.indexOf('req.text()') && serve.indexOf('requireWriteKey(req)') < serve.indexOf('createClient('),
    'the write key is checked before the body is read or a service-role client exists');
  ok(/Deno\.env\.get\("ANALYTICS_MIRROR_WRITE_KEY"\)/.test(WRITE_SRC) && /secret\.length >= 32/.test(WRITE_SRC) && /timingSafeEqual/.test(WRITE_SRC),
    'the writer needs its own long secret, compared in constant time');
  ok(!/Access-Control-Allow-Origin|OPTIONS/.test(WRITE_SRC), 'the writer exposes no browser CORS surface');
  ok(/"analytics_mirror_write_enabled"/.test(serve) && /mirror_write_disabled/.test(serve), 'the writer is off until its flag is on');
  ok(/"client_profiles_authority"/.test(serve) && /client_profiles_owned_by_syncview/.test(serve)
    && /filter\(r => !unchangedEdit\(r\)\)/.test(WRITE_SRC) && /cur\.source !== "syncview"/.test(WRITE_SRC)
    && /archived_at: now/.test(WRITE_SRC) && !/\.delete\(/.test(WRITE_SRC),
    'the Sheet copy of client profiles stops when SyncView owns them, skips a SyncView-edited row only while the Sheet still matches it, and archives instead of deleting');
  ok(/analytics_ingest_receipts/.test(serve) && /MAX_ROWS_PER_CALL/.test(serve) && /MAX_BODY_BYTES/.test(serve),
    'every write leaves a receipt and is size-bounded');

  // ---- analytics-read safety ----
  ok(/\[functions\.analytics-read\]\s*verify_jwt = false/.test(CONFIG), 'analytics-read has an explicit transport posture in config.toml');
  ok(/authorizeStaffKey\(staffKey, \["admin", "smm", "creative"\]\)/.test(READ_SRC), 'staff are proven by their role key');
  ok(/from\("client_access"\)/.test(READ_SRC) && /client\.active === true/.test(READ_SRC) && /timingSafeEqual\(token, stored\)/.test(READ_SRC)
    && !/permissive/.test(READ_SRC.replace(/\/\/.*$/gm, "")), 'a client is proven by its own active link token, strictly (no permissive fallback)');
  ok((READ_SRC.match(/\.eq\("client_slug", slug\)/g) || []).length === 4 && /\.eq\("slug", slug\)/.test(READ_SRC),
    'every dataset is filtered to the one client asked for');
  ok(/\.gte\("scraped_date", cutoff\)/.test(READ_SRC), 'TopVideos is limited to the last 90 days');
  ok(/contains\("client_slugs", \[slug\]\)/.test(READ_SRC) && /eq\("full_snapshot", true\)/.test(READ_SRC)
    && /eq\("complete", true\)/.test(READ_SRC) && !/latestReceipts/.test(READ_SRC),
    'a receipt vouches for a client only if it listed that client or was a whole-dataset copy (Codex P1 on #1623)');
  ok(/full_snapshot_not_allowed/.test(WRITE_SRC) && /fullSnapshot && \(source === "n8n" \|\| !complete\)/.test(WRITE_SRC),
    'n8n can never claim a whole-dataset receipt');
  ok(!/sidneylaruel/.test(read('scripts/sheets-mirror-read-timing.js')) && /pass --slug=/.test(read('scripts/sheets-mirror-read-timing.js')),
    'the timing script carries no client slug; the slug is passed in');
  ok(/range\(a, b\)/.test(READ_SRC) && /PAGE = 1000/.test(READ_SRC), 'reads page past the 1000-row server limit');
  ok(/principal === "staff" \? \(data \|\| null\) : profileForClientLink/.test(READ_SRC), 'a client link gets the reduced profile');
  ok(READ_SRC.indexOf('mirror_read_disabled') < READ_SRC.indexOf('clientTokenValid(supabase, slug, token))'),
    'client-link reads are refused while the read flag is off');

  // ---- Clients admin tab (read-only list) ----
  {
    const i = READ_SRC.indexOf('"list_client_profiles"');
    const branch = READ_SRC.slice(i, READ_SRC.indexOf('const slug = clientSlug', i));
    ok(i > 0 && /authorizeStaffKey\(staffKey, \["admin"\]\)/.test(branch) && !/client_access|clientTokenValid|x-syncview-client-token/.test(branch),
      'the client list is admin-role only and never reachable by a client link token');
    ok(!/row_hash/.test(READ_SRC.match(/CLIENT_PROFILE_ADMIN_COLUMNS = "([^"]+)"/)[1]), 'the admin list does not expose copy-job internals');
    ok(!/\.(insert|update|upsert|delete)\(/.test(READ_SRC), 'analytics-read stays read-only');
  }

  // ---- migration posture ----
  ok(/revoke all on table public\.%I from public, anon, authenticated, service_role/.test(MIGRATION)
    && /revoke all on sequence %s from public, anon, authenticated, service_role/.test(MIGRATION),
    'the migration revokes tables and sequences from all four roles');
  ok(/grant select, insert, update on table public\.%I to service_role/.test(MIGRATION) && !/\bgrant\b[^;]*\bto\s+(anon|authenticated|public)\b/i.test(MIGRATION.replace(/--.*$/gm, '')),
    'only service_role is granted anything, and never delete or truncate');
  ok(/enable row level security/.test(MIGRATION) && !/create policy/i.test(MIGRATION), 'RLS on, no policies');

  console.log(`sheets-mirror-policy: ${checks} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
