'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

[
  'SYNCVIEW_STAFF_IDENTITY_KEY',
  'STAFF_KEY_VERIFY_URL',
  '_syncviewStaffIdentityBoot',
  '_syncviewOpenStaffIdentity',
  '_syncviewVerifyStaffIdentity',
  '_syncviewStaffIdentityForHeaders',
  '_syncviewStaffRefreshChrome',
].forEach(token => ok(source.includes(token), `staff login wiring includes ${token}`));

ok(/team_members\?active=eq\.true&select=id,name,role,team/.test(source), 'name choices come from active team_members rows');
ok(/_ccSelectHtml\('staffIdentityMember', memberItems, selectedId, 'Choose your name'\)/.test(source), 'identity modal uses the shared custom roster picker');
ok(/const memberInput = overlay\.querySelector\('#staffIdentityMember'\)[\s\S]{0,900}String\(memberInput\.value\)/.test(source), 'custom roster picker feeds the existing form-submit value path');
ok(/Choose your name\.'; memberTrigger\.focus\(\)/.test(source), 'roster validation focuses the custom picker trigger');
ok(!/id="staffIdentity(?:Name|Other)"/.test(source), 'identity modal has no free-text name field');
ok(/id="staffIdentityKeyToggle"[^>]+aria-label="Show role key"[^>]+onclick="_syncviewToggleStaffRoleKey\(this\)"/.test(source), 'role key has an accessible visibility toggle');
ok(/function _syncviewToggleStaffRoleKey\(button\)[\s\S]{0,260}button\.setAttribute\('aria-label', label\)/.test(source), 'role-key visibility toggle updates its accessible label');
ok(/\.staff-auth-overlay\s*\{[^}]*background:\s*var\(--sv-bg-rgba-0-0-0-0_5\)[^}]*backdrop-filter:\s*blur\(3px\)/.test(source), 'staff sign-in overlay uses a stronger blurred scrim');
ok(/await _syncviewStaffIdentityBoot\(\)/.test(source), 'boot validates a stored staff key before route restoration');
ok(/e && e\.status === 401[\s\S]{0,180}_syncviewStaffIdentityClear\(\)/.test(source), 'an invalid stored key is cleared');
ok(/staff key verifier unavailable; keeping auth permissive/.test(source), 'verifier outages preserve permissive app access');
ok(/function _prodAccessAllowed\(\)[\s\S]{0,120}_prodEnabled\(\) \|\| _syncviewStaffIdentityValid\(\)/.test(source), 'Production access accepts direct preview or a verified staff identity');
ok(/if \(page === 'production'\) query\.set\('prod', '1'\)/.test(source), 'staff Production navigation preserves the existing prod route gate');
ok(/else query\.delete\('prod'\)/.test(source), 'leaving Production removes the preview query gate');
ok(/_settingsWriteHeaders\('templates', writeUrl\)/.test(source), 'template EF writes pass their target URL into shared auth headers');
ok(/_settingsWriteHeaders\('caption-prompts', writeUrl\)/.test(source), 'caption-prompt EF writes pass their target URL into shared auth headers');
ok(!/syncview_runtime_flags[^\n]{0,120}(PATCH|POST|update)/i.test(functionSource('_syncviewStaffIdentityBoot')), 'staff boot does not mutate runtime flags');

const context = vm.createContext({
  CAL_SUPABASE_URL: 'https://project.example',
  _isClientLink: false,
  _syncviewClientWriteToken: () => 'client-token',
  _syncviewStaffIdentityForHeaders: () => ({
    key: 'dummy-role-key',
    role: 'creative',
    member: { name: 'Dummy Editor' },
  }),
});
vm.runInContext(functionSource('_syncviewEfHeaders'), context);

const efHeaders = context._syncviewEfHeaders({ 'Content-Type': 'application/json', 'X-Syncview-Actor': 'SyncView' }, 'https://project.example/functions/v1/calendar-upsert');
ok(efHeaders['X-Syncview-Key'] === 'dummy-role-key', 'staff EF request receives the stored role key');
ok(efHeaders['X-Syncview-Actor'] === 'Dummy Editor', 'staff EF request receives the roster actor');
ok(efHeaders['X-Syncview-Role'] === 'creative', 'staff EF request receives the verified role');

const n8nHeaders = context._syncviewEfHeaders({ 'Content-Type': 'application/json' }, 'https://automation.example/webhook/save');
ok(!n8nHeaders['X-Syncview-Key'], 'role key is never sent to an n8n fallback');

context._isClientLink = true;
const clientHeaders = context._syncviewEfHeaders({ 'Content-Type': 'application/json' }, 'https://project.example/functions/v1/calendar-upsert');
ok(clientHeaders['X-Syncview-Client-Token'] === 'client-token', 'client links keep the client-token path');
ok(!clientHeaders['X-Syncview-Key'], 'client links never receive the staff role key');

if (failures) {
  console.error(`\n${failures} B4 staff-login source check(s) failed`);
  process.exit(1);
}
console.log('\nB4 staff-login source checks passed');
