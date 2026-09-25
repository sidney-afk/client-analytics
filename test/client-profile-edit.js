'use strict';
// Clients tab, step 2: an admin's edit goes to the Clients Info Sheet first
// (only the changed cells, only if the row still matches what was loaded),
// then to Supabase with source='syncview' and a history row per field.
// Checks the pure planner (supabase/functions/_shared/client-profile-edit.mjs)
// and the rules the client-profile-write Edge Function must keep.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let passed = 0;
function ok(cond, msg) { if (!cond) { console.error('FAIL ' + msg); process.exit(1); } passed++; console.log('  ok  ' + msg); }

(async () => {
  const m = await import(path.join(ROOT, 'supabase/functions/_shared/client-profile-edit.mjs'));
  const HEAD = ['client_name', 'email', 'competitors', 'keywords', 'specific_keywords', 'content_description', 'instagram_handle',
    'tiktok_handle', 'youtube_channel_id', 'slack_channel_id', 'creative_channel_id', 'roam_channel_id', 'upload_post_profile', 'postforme_account_id'];
  const sheet = () => [HEAD,
    ['Avery Fixture', 'a@example.invalid', '', 'k', '', 'reels', '@avery', '', '', 'C1', '', 'R1', '', ''],
    ['Blake Sample', 'b@example.invalid', '', '', '', '', '@blake', '', '', '', '', '', '', '']];
  const loaded = { slug: 'averyfixture', email: 'a@example.invalid', competitors: null, keywords: 'k', specific_keywords: null,
    content_description: 'reels', instagram_handle: '@avery', tiktok_handle: null, youtube_channel_id: null, slack_channel_id: 'C1',
    creative_channel_id: null, upload_post_profile: null, postforme_account_id: null };

  ok(m.columnLetter(0) === 'A' && m.columnLetter(25) === 'Z' && m.columnLetter(26) === 'AA' && m.columnLetter(27) === 'AB', 'column letters');
  ok(m.sheetRange("Clients Info", 'B2') === "'Clients Info'!B2" && m.sheetRange("O'Neil", 'A1') === "'O''Neil'!A1", 'tab names are quoted');

  const plan = m.planSheetEdit(sheet(), 'averyfixture', loaded, { email: 'new@example.invalid', tiktok_handle: '@avery2', keywords: 'k' });
  ok(plan.ok && plan.sheet_row === 2, 'the row is found by client name');
  ok(JSON.stringify(plan.updates.map(u => u.range)) === JSON.stringify(["'Clients Info'!B2", "'Clients Info'!H2"]),
    'only the changed cells are written (an unchanged value is skipped)');
  ok(!plan.updates.some(u => /L2/.test(u.range)), 'the Roam column is never written');

  const drifted = sheet(); drifted[1][6] = '@someone-else';
  const d = m.planSheetEdit(drifted, 'averyfixture', loaded, { email: 'new@example.invalid' });
  ok(!d.ok && d.error === 'sheet_changed' && d.fields.join() === 'instagram_handle' && d.sheet_values.instagram_handle === '@someone-else',
    'a Sheet cell edited since the row was loaded blocks the save, even outside the edited field, and reports it');
  ok(m.planSheetEdit(sheet(), 'nobody', loaded, { email: 'x' }).error === 'sheet_row_missing', 'a client missing from the Sheet is refused');
  const dup = sheet(); dup.push(['Avery Fixture', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  ok(m.planSheetEdit(dup, 'averyfixture', loaded, { email: 'x' }).error === 'sheet_row_ambiguous', 'two Sheet rows for one client are refused');
  const nohead = sheet(); nohead[0] = HEAD.filter(h => h !== 'email');
  ok(m.planSheetEdit(nohead, 'averyfixture', loaded, { email: 'x' }).error === 'sheet_header_missing', 'a missing Sheet column is refused');
  ok(m.sameValue(null, '') && m.sameValue(' a ', 'a') && !m.sameValue('a', 'b'), 'empty cells equal null columns; whitespace is ignored');

  ok(m.normalizeChanges({ display_name: 'x' }).error === 'field_not_editable', 'the client name (the row key) is not editable');
  ok(m.normalizeChanges({ roam_channel_id: 'x' }).error === 'field_not_editable', 'the Roam channel is not editable');
  ok(m.normalizeChanges({ email: 5 }).error === 'bad_value' && m.normalizeChanges({}).error === 'no_changes', 'bad values and empty edits are refused');
  ok(m.normalizeChanges({ email: 'x'.repeat(m.MAX_FIELD_CHARS + 1) }).error === 'value_too_long', 'values are size-bounded');

  const fn = read('supabase/functions/client-profile-write/index.ts');
  const serve = fn.slice(fn.indexOf('Deno.serve('));
  ok(/authorizeStaffKey\(staffKey, \["admin"\]\)/.test(serve) && serve.indexOf('authorizeStaffKey') < serve.indexOf('req.text()'),
    'the admin role key is checked before the body is read');
  ok(!/client_access|x-syncview-client-token|ANALYTICS_MIRROR_WRITE_KEY/.test(fn), 'no client token or n8n key can reach it');
  ok(/adminMember\(/.test(serve) && /clean\(m\.role\) !== "admin"/.test(fn), 'the editor must be an active admin team member');
  ok(/await authority\(supabase\) !== "sheet"/.test(serve), 'it refuses to run unless the Sheet is still the main copy');
  const w = serve.indexOf('await writeCells('), r = serve.indexOf('supabase.rpc("client_profile_admin_edit"');
  ok(w > 0 && r > w && serve.indexOf('planSheetEdit(values, slug, current, changes') < w, 'order: check the Sheet row, write the Sheet, then Supabase');
  ok(/valueInputOption: "RAW"/.test(fn), 'cells are written as plain text, never as formulas');
  ok(/saved_to_sheet_only/.test(serve), 'a Supabase failure after the Sheet write is reported, not hidden');
  ok(!/\.delete\(|\.insert\(|\.upsert\(/.test(fn) && !/"client_profile_edits"/.test(fn), 'history is written only by the SQL function, never directly');
  ok(!/client_profiles_authority[^\n]*update|\.update\(\{[^}]*authority/.test(fn), 'the authority flag is never changed');
  ok(!/\/\*[\s\S]*?\d{1,3}[A-Za-z0-9_-]{40,}/.test(fn) && /Deno\.env\.get\(SHEET_ID_SECRET\)/.test(fn), 'the Sheet id comes from a secret, not the source');

  const mig = read('migrations/2026-09-25-client-profile-edits.sql');
  ok(/revoke all on table public\.client_profile_edits from public, anon, authenticated, service_role;/.test(mig)
    && /grant select, insert on table public\.client_profile_edits to service_role;/.test(mig), 'history table: all four roles revoked, service_role select+insert only');
  ok(/revoke all on function public\.client_profile_admin_edit\([^)]*\)\s*from public, anon, authenticated, service_role;/.test(mig)
    && /grant execute on function public\.client_profile_admin_edit\([^)]*\)\s*to service_role;/.test(mig), 'edit function: all four roles revoked, service_role execute only');
  ok(/enable row level security/.test(mig) && !/create policy/i.test(mig), 'RLS on, no policies');
  ok(/source = 'syncview'/.test(mig) && /client_profile_version_conflict/.test(mig), 'the function sets source syncview and checks the version');

  const cfg = read('supabase/config.toml');
  ok(/\[functions\.client-profile-write\]\s*\nverify_jwt = false/.test(cfg), 'client-profile-write has an explicit transport posture in config.toml');
  console.log(`client-profile-edit: ${passed} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
