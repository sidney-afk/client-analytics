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
  ok(/const mode = await authority\(supabase\);/.test(serve) && /if \(mode !== "sheet"\) return json\(\{ ok: false, error: "authority_not_sheet" \}, 409\)/.test(serve), 'it still refuses unless the Sheet is the main copy, except the native save below');
  ok(/mode === "syncview" && action === "update_client_profile"\) return await nativeUpdate\(/.test(serve), 'once the owner moves the main copy to SyncView, only the edit takes the native path; refresh_from_sheet stays refused');
  const nat = fn.slice(fn.indexOf('async function nativeUpdate'), fn.indexOf('Deno.serve('));
  ok(!/readTab\(|writeCells\(|googleToken\(/.test(nat), 'the native save never reads or writes the Sheet itself (the read-only copy is made afterwards, best effort)');
  ok(/p_sheet_row: null/.test(nat) && /client_profile_version_conflict/.test(nat) && /copyToSheet\(/.test(nat), 'native save: same version check and transaction, then the queued copy');
  ok(/if \(error\) throw error;\s*const v = data && data\.value/.test(fn) && !/clean\(v\.source\) \|\| "sheet"/.test(fn), 'an unreadable or missing authority flag fails closed');
  const w = serve.indexOf('await writeCells('), r = serve.indexOf('supabase.rpc("client_profile_admin_edit"');
  ok(w > 0 && r > w && serve.indexOf('planSheetEdit(values, slug, current, changes') < w, 'order: check the Sheet row, write the Sheet, then Supabase');
  ok(/valueInputOption: "RAW"/.test(fn), 'cells are written as plain text, never as formulas');
  ok(/saved_to_sheet_only/.test(serve), 'a Supabase failure after the Sheet write is reported, not hidden');
  // The history is READ by the Clients tab's "See history" (action history), never written here.
  const histOnly = fn.slice(fn.indexOf('async function history'), fn.indexOf('Deno.serve('));
  ok(!/\.delete\(|\.insert\(|\.upsert\(/.test(fn) && fn.split('"client_profile_edits"').length === 2 && /"client_profile_edits"\)\.select\(/.test(histOnly),
    'history is written only by the SQL function, never directly (it is only read, by the history action)');
  ok(!/client_profiles_authority[^\n]*update|\.update\(\{[^}]*authority/.test(fn), 'the authority flag is never changed');
  ok(!/\/\*[\s\S]*?\d{1,3}[A-Za-z0-9_-]{40,}/.test(fn) && /Deno\.env\.get\(SHEET_ID_SECRET\)/.test(fn), 'the Sheet id comes from a secret, not the source');

  const mig = read('migrations/2026-09-25-client-profile-edits.sql');
  ok(/revoke all on table public\.client_profile_edits from public, anon, authenticated, service_role;/.test(mig)
    && /grant select, insert on table public\.client_profile_edits to service_role;/.test(mig), 'history table: all four roles revoked, service_role select+insert only');
  ok(/revoke all on function public\.client_profile_admin_edit\([^)]*\)\s*from public, anon, authenticated, service_role;/.test(mig)
    && /grant execute on function public\.client_profile_admin_edit\([^)]*\)\s*to service_role;/.test(mig), 'edit function: all four roles revoked, service_role execute only');
  ok(/enable row level security/.test(mig) && !/create policy/i.test(mig), 'RLS on, no policies');
  ok(/source = 'syncview'/.test(mig) && /client_profile_version_conflict/.test(mig), 'the function sets source syncview and checks the version');

  // The Clients tab's manager picker and history (owner's pick, 2026-10-07).
  const memberAt = serve.indexOf('const member = await adminMember(');
  ok(['list_managers', 'assign_manager', 'history'].every(a => serve.indexOf(`action === "${a}"`) > memberAt && memberAt > 0),
    'the picker and history actions run only after the active admin member is checked');
  const asg = fn.slice(fn.indexOf('async function assignManager'), fn.indexOf('async function history'));
  ok(/supabase\.rpc\("smm_assign_client"/.test(asg) && /p_role: "admin"/.test(asg) && /p_actor: member\.name/.test(asg),
    'a manager move goes through smm_assign_client as the admin, with the member recorded as the editor');
  ok(/roster\.managers\.find\(m => m\.slug === managerSlug\)/.test(asg) && /if \(!target\) return json\(\{ ok: false, error: "bad_manager" \}, 400\)/.test(asg),
    'the picker can only choose an existing active manager, never create one');
  ok(/"expected_manager_slug" in body/.test(asg) && /manager_changed/.test(asg), 'a move refuses if the manager changed since the page loaded it');
  ok(/archived_at\) return json\(\{ ok: false, error: "client_profile_archived" \}, 409\)/.test(asg), 'an archived client cannot be moved');
  ok(asg.indexOf('copyToSheet(') > asg.indexOf('smm_assign_client'), 'the Sheet copy follows the move, best effort');
  const hist = fn.slice(fn.indexOf('async function history'), fn.indexOf('Deno.serve('));
  ok(!/\.(insert|update|upsert|delete)\(/.test(hist) && !/\.(insert|update|upsert|delete)\(/.test(fn.slice(fn.indexOf('async function listManagers'), fn.indexOf('async function assignManager'))),
    'list_managers and history only read');

  const cfg = read('supabase/config.toml');
  ok(/\[functions\.client-profile-write\]\s*\nverify_jwt = false/.test(cfg), 'client-profile-write has an explicit transport posture in config.toml');
  console.log(`client-profile-edit: ${passed} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
